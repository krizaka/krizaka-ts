import { defineModule } from "@krizaka/db";

/**
 * The tables of « payments », in their own Postgres schema (ADR-001 §3). `event` is the record of the processor's notifications
 * already applied (one row per event id, the same shape as the `payment_events` Yomizaka's migration 0009 and Akinaza's 0010 made);
 * `discount` remembers the processor's object made for each `(coupon, terms version)`. They reference no product table.
 * Version 1 is frozen once released: a change is version 2.
 *
 * A product that already has `public.payment_events` moves it first with {@link adoptPaymentEventsSql}, then emits version 1
 * (`CREATE TABLE IF NOT EXISTS` leaves the moved table as it is).
 */
export const paymentsSchema = defineModule({
  module: "payments",
  migrations: [
    {
      version: 1,
      name: "event and discount",
      sql: (c) => `
CREATE TABLE IF NOT EXISTS ${c.schema}.event (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ${c.schema}.discount (
  coupon_id     text NOT NULL CHECK (char_length(coupon_id) BETWEEN 1 AND 100),
  terms_version integer NOT NULL CHECK (terms_version >= 1),
  provider      text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,39}$'),
  provider_ref  text NOT NULL,
  PRIMARY KEY (coupon_id, terms_version, provider)
);`,
    },
  ],
});

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * The SQL that moves a product's existing `payment_events` into the module's schema as `event`, keeping every row, so version 1
 * finds it there. Idempotent: it does nothing when the table is not there any more. Run it once in the product's migrations,
 * before `emitMigration(paymentsSchema, 1, …)`.
 * @param from the schema the table is in, default `public`
 * @param to the module's schema, default `payments`
 * @throws Error when a name is not a safe SQL identifier
 */
export function adoptPaymentEventsSql(from = "public", to = "payments"): string {
  for (const name of [from, to]) if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${name}`);
  return `CREATE SCHEMA IF NOT EXISTS ${to};
DO $$ BEGIN
  IF to_regclass('${from}.payment_events') IS NOT NULL AND to_regclass('${to}.event') IS NULL THEN
    ALTER TABLE ${from}.payment_events SET SCHEMA ${to};
    ALTER TABLE ${to}.payment_events RENAME TO event;
  END IF;
END $$;`;
}
