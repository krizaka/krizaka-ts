import { defineModule } from "@krizaka/db";

/**
 * The tables of « audit », in their own Postgres schema (ADR-001 §3). The one product table referenced is the owner (the
 * account table), declared by the product; deleting an account keeps its entries with the actor detached.
 * Version 1 is frozen once released: a change is version 2.
 */
export const auditSchema = defineModule({
  module: "audit",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "entries",
      sql: (c) => `
CREATE TABLE ${c.schema}.entry (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  actor_id    uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL,
  actor_label text NOT NULL CHECK (char_length(actor_label) BETWEEN 1 AND 120),
  action      text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$' AND char_length(action) <= 80),
  target_type text CHECK (target_type IS NULL OR char_length(target_type) <= 40),
  target_id   text CHECK (target_id IS NULL OR char_length(target_id) <= 200),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet
);
CREATE INDEX entry_at ON ${c.schema}.entry (at DESC);
CREATE INDEX entry_action ON ${c.schema}.entry (action, at DESC);
CREATE INDEX entry_target ON ${c.schema}.entry (target_type, target_id, at DESC);
CREATE INDEX entry_actor ON ${c.schema}.entry (actor_id) WHERE actor_id IS NOT NULL;`,
    },
  ],
});
