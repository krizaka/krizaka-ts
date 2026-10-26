import { settingsMigration } from "./migration";
import type { PriceStore, StoredPriceVersion } from "./price-catalogue";
import type { Price } from "./prices";
import type { Query } from "./service";

/**
 * The price versions in the product's PostgreSQL (`price_versions`), each insert writing its audit line in `settings_audit`
 * (key `price.<product>.<plan>`) in the same statement. Rows are only ever added: a version once sold is never rewritten.
 */
export function pricesMigration(): string {
  return `${settingsMigration()}
CREATE TABLE IF NOT EXISTS price_versions (
  id             bigserial PRIMARY KEY,
  key            text NOT NULL CHECK (key ~ '^[a-z][a-zA-Z0-9-]{0,39}[.][a-z][a-zA-Z0-9-]{0,39}$'),
  price          jsonb NOT NULL,
  before         jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at     timestamptz NOT NULL,
  actor_id       uuid,
  actor_label    text NOT NULL
);
CREATE INDEX IF NOT EXISTS price_versions_key ON price_versions(key, id);
`;
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
