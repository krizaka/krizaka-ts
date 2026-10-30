import { ident, type Query } from "@krizaka/db";

import type { DiscountStore, EventStore } from "./port";

/**
 * The PostgreSQL record of applied notifications, `payments.event (id text primary key, type text not null, received_at timestamptz default now())`
 * (see `paymentsSchema`; it is also the shape of the `payment_events` table Yomizaka and Akinaza already have).
 * @param query the product's query, or the transaction's
 * @param table the schema and table, default `payments.event`
 */
export function dbEventStore(
  query: Query,
  table: { schema: string; table: string } = { schema: "payments", table: "event" },
): Required<EventStore> {
  const name = `${ident(table.schema)}.${ident(table.table)}`;
  return {
    async markSeen(id, type, at) {
      const rows = at
        ? await query(
            `INSERT INTO ${name} (id, type, received_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
            [id, type, at],
          )
        : await query(`INSERT INTO ${name} (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`, [
            id,
            type,
          ]);
      return rows.length > 0;
    },
    async forget(id) {
      await query(`DELETE FROM ${name} WHERE id = $1`, [id]);
    },
  };
}

/** The PostgreSQL memory of the processor's objects made for a discount's terms: `payments.discount`. */
export function dbDiscountStore(query: Query, schema = "payments"): DiscountStore {
  const table = `${ident(schema)}.discount`;
  return {
    async find(couponId, termsVersion, provider) {
      const [row] = await query<{ provider_ref: string }>(
        `SELECT provider_ref FROM ${table} WHERE coupon_id = $1 AND terms_version = $2 AND provider = $3`,
        [couponId, termsVersion, provider],
      );
      return row?.provider_ref ?? null;
    },
    async remember(couponId, termsVersion, provider, providerRef) {
      await query(
        `INSERT INTO ${table} (coupon_id, terms_version, provider, provider_ref) VALUES ($1, $2, $3, $4) ON CONFLICT (coupon_id, terms_version, provider) DO NOTHING`,
        [couponId, termsVersion, provider, providerRef],
      );
      const [row] = await query<{ provider_ref: string }>(
        `SELECT provider_ref FROM ${table} WHERE coupon_id = $1 AND terms_version = $2 AND provider = $3`,
        [couponId, termsVersion, provider],
      );
      return row?.provider_ref ?? providerRef;
    },
  };
}

/** The record as Yomizaka and Akinaza have it today, `public.payment_events`: for a product that has not moved it yet (see `adoptPaymentEventsSql`). */
export const pgEventStore = (query: Query): Required<EventStore> =>
  dbEventStore(query, { schema: "public", table: "payment_events" });
