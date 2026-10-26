import { defineModule } from "@krizaka/db";

/**
 * The tables of « outbox », in their own Postgres schema (ADR-001 §3). `message` is the outbox itself, the columns of the Java kit's
 * envelope (id, type, occurredAt = created_at, payload) and the state of its delivery; `processed` is the idempotent consumers'
 * record of the message ids they already applied. They reference no product table. Version 1 is frozen once released: a change is version 2.
 */
export const outboxSchema = defineModule({
  module: "outbox",
  migrations: [
    {
      version: 1,
      name: "messages and processed",
      sql: (c) => `
CREATE TABLE ${c.schema}.message (
  id           uuid PRIMARY KEY,
  topic        text NOT NULL CHECK (topic ~ '^[a-z][a-z0-9_.:-]{0,59}$'),
  event_type   text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  leased_until timestamptz,
  lease_owner  text,
  delivered_at timestamptz,
  dead_at      timestamptz,
  last_error   text,
  CHECK (delivered_at IS NULL OR dead_at IS NULL)
);
CREATE INDEX message_due ON ${c.schema}.message (topic, available_at) WHERE delivered_at IS NULL AND dead_at IS NULL;
CREATE INDEX message_finished ON ${c.schema}.message (COALESCE(delivered_at, dead_at)) WHERE delivered_at IS NOT NULL OR dead_at IS NOT NULL;
CREATE TABLE ${c.schema}.processed (
  consumer     text NOT NULL CHECK (char_length(consumer) BETWEEN 1 AND 100),
  message_id   uuid NOT NULL,
  processed_at timestamptz NOT NULL,
  PRIMARY KEY (consumer, message_id)
);`,
    },
  ],
});
