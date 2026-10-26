import { defineModule } from "@krizaka/db";

/**
 * The tables of « credits », in their own Postgres schema (ADR-001 §3), following `krizaka-billing`'s model and names: `grant` (a pot:
 * `granted` with an expiry and optional caps, or `purchased`), `entry` (the ledger: GRANT, PURCHASE, DEBIT, REFUND, EXPIRY, ADJUSTMENT;
 * APPEND-ONLY, a trigger refuses any UPDATE or DELETE) and `hold` (credits kept back for work in progress). Nothing stores a balance: what is
 * left of a pot is the sum of its lines. The one product table referenced is the owner (`owner`: the account table), declared by the product;
 * an account that has credits is anonymised, never deleted (it is an accounting record), exactly like an invoice.
 * Version 1 is frozen once released: a change is version 2.
 */
export const creditsSchema = defineModule({
  module: "credits",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "grants, ledger and holds",
      sql: (c) => `
CREATE TABLE ${c.schema}."grant" (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES ${c.tables.owner}(id),
  bucket        text NOT NULL CHECK (bucket IN ('granted', 'purchased')),
  amount        bigint NOT NULL CHECK (amount > 0),
  cap_per_day   bigint CHECK (cap_per_day IS NULL OR cap_per_day > 0),
  cap_per_month bigint CHECK (cap_per_month IS NULL OR cap_per_month > 0),
  expires_at    timestamptz,
  on_exhausted  text NOT NULL CHECK (on_exhausted IN ('stop', 'fallback_paid')),
  source        text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 200),
  created_at    timestamptz NOT NULL,
  CHECK ((bucket = 'granted' AND expires_at IS NOT NULL)
      OR (bucket = 'purchased' AND expires_at IS NULL AND cap_per_day IS NULL AND cap_per_month IS NULL))
);
CREATE INDEX grant_account ON ${c.schema}."grant" (account_id, created_at);
CREATE INDEX grant_lapse ON ${c.schema}."grant" (expires_at) WHERE bucket = 'granted';
CREATE TABLE ${c.schema}.hold (
  id             uuid PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES ${c.tables.owner}(id),
  amount         bigint NOT NULL CHECK (amount > 0),
  expires_at     timestamptz NOT NULL,
  status         text NOT NULL CHECK (status IN ('active', 'settled', 'released')),
  settled_amount bigint CHECK (settled_amount IS NULL OR settled_amount >= 0),
  created_at     timestamptz NOT NULL,
  closed_at      timestamptz,
  operation      text NOT NULL UNIQUE
);
CREATE INDEX hold_active ON ${c.schema}.hold (account_id) WHERE status = 'active';
CREATE TABLE ${c.schema}.entry (
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  id              uuid PRIMARY KEY,
  account_id      uuid NOT NULL,
  grant_id        uuid REFERENCES ${c.schema}."grant"(id),
  type            text NOT NULL CHECK (type IN ('GRANT', 'PURCHASE', 'DEBIT', 'REFUND', 'EXPIRY', 'ADJUSTMENT')),
  amount          bigint NOT NULL CHECK (amount <> 0 OR type = 'EXPIRY'),
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  operation       text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reverses        text,
  hold_id         uuid,
  at              timestamptz NOT NULL
);
CREATE INDEX entry_account ON ${c.schema}.entry (account_id, seq DESC);
CREATE INDEX entry_grant ON ${c.schema}.entry (grant_id);
CREATE INDEX entry_operation ON ${c.schema}.entry (operation);
CREATE FUNCTION ${c.schema}.entry_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'credits.entry is append-only: % refused', TG_OP;
END;
$fn$;
CREATE TRIGGER entry_append_only BEFORE UPDATE OR DELETE ON ${c.schema}.entry FOR EACH ROW EXECUTE FUNCTION ${c.schema}.entry_is_append_only();`,
    },
  ],
});
