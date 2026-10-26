import { settingsMigration } from "./migration";
import type { PriceStore, StoredPriceVersion } from "./price-catalogue";
import type { Price } from "./prices";
import { pricesSchema } from "./schema";
import type { Query } from "./service";

/**
 * The settings tables, then the price versions' (`price_versions`), for a product that runs the SQL by hand.
 * @deprecated Use `settingsSchema` and `pricesSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`. Removed in the next major.
 */
export function pricesMigration(): string {
  return `${settingsMigration()}${pricesSchema.migrations[0]!.sql({ schema: "public", tables: {} })}`;
}

interface Row {
  id: string;
  key: string;
  price: Price;
  before: Price;
  effective_from: Date;
  created_at: Date;
  actor_label: string;
}
const COLUMNS = "id, key, price, before, effective_from, created_at, actor_label";
const fromRow = (r: Row): StoredPriceVersion => ({ id: String(r.id), key: r.key, price: r.price, before: r.before, effectiveFrom: r.effective_from, createdAt: r.created_at, actorLabel: r.actor_label });

export function priceStore({ query }: { query: Query }): PriceStore {
  return {
    async versions(key) {
      return (await query<Row>(`SELECT ${COLUMNS} FROM price_versions WHERE key = $1 ORDER BY id`, [key])).map(fromRow);
    },
    async version(id) {
      const row = (await query<Row>(`SELECT ${COLUMNS} FROM price_versions WHERE id = $1`, [id]))[0];
      return row ? fromRow(row) : null;
    },
    async insert(v, actor) {
      const rows = await query<Row>(
        `WITH v AS (
           INSERT INTO price_versions (key, price, before, effective_from, created_at, actor_id, actor_label) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}
         ), a AS (
           INSERT INTO settings_audit (at, actor_id, actor_label, scope, scope_id, key, before, after)
           SELECT $5, $6, $7, 'global', '', 'price.' || $1, $3, jsonb_set($2::jsonb, '{effectiveFrom}', to_jsonb($4::timestamptz)) FROM v
         )
         SELECT ${COLUMNS} FROM v`,
        [v.key, JSON.stringify(v.price), JSON.stringify(v.before), v.effectiveFrom, v.createdAt, actor.id, actor.label],
      );
      return fromRow(rows[0]!);
    },
  };
}
