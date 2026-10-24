import { defineModule } from "@krizaka/db";

/**
 * The table of « outbox », in its own Postgres schema (ADR-001 §3). It references no product table: any module's events
 * go through it. Version 1 is frozen once released: a change is version 2.
 */
export const outboxSchema = defineModule({
  module: "outbox",
  migrations: [
    {
      version: 1,
      name: "messages",
      sql: (c) => `
CREATE TABLE ${c.schema}.message (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 120),
  event_type   text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 160),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  leased_until timestamptz,
  lease_owner  text,
  delivered_at timestamptz,
  dead_at      timestamptz,
  last_error   text
);
CREATE INDEX message_due ON ${c.schema}.message (available_at, created_at) WHERE delivered_at IS NULL AND dead_at IS NULL;
CREATE INDEX message_dead ON ${c.schema}.message (dead_at DESC) WHERE dead_at IS NOT NULL;`,
    },
  ],
});
