import { defineModule } from "@krizaka/db";

/**
 * The tables of « mail », in their own Postgres schema: `delivery` (the log, with the recipient as a hash, never a body),
 * `suppression` (the addresses never mailed again, as a SHA-256 hash: the list holds no address) and `idempotency` (the keys
 * already sent). They reference no product table. Version 1 is frozen once released: a change is version 2.
 */
export const mailSchema = defineModule({
  module: "mail",
  migrations: [
    {
      version: 1,
      name: "delivery, suppression and idempotency",
      sql: (c) => `
CREATE TABLE ${c.schema}.delivery (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL,
  template        text NOT NULL,
  category        text NOT NULL,
  locale          text NOT NULL,
  to_hash         text NOT NULL CHECK (char_length(to_hash) = 64),
  status          text NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed', 'duplicate')),
  message_id      text,
  idempotency_key text,
  detail          text
);
CREATE INDEX delivery_at ON ${c.schema}.delivery (at);
CREATE TABLE ${c.schema}.suppression (
  address_hash text PRIMARY KEY CHECK (char_length(address_hash) = 64),
  reason       text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'unsubscribed')),
  created_at   timestamptz NOT NULL
);
CREATE TABLE ${c.schema}.idempotency (
  key        text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL
);
CREATE INDEX idempotency_created ON ${c.schema}.idempotency (created_at);`,
    },
  ],
});
