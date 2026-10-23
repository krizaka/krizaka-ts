import { defineModule } from "@krizaka/db";

/**
 * The tables of the settings, as a versioned module (ADR-001 §3): the overrides (global, for a workspace, for one user — the most
 * specific wins) and the audit of every change (who, what, when, before, after). They stay where the product has them (`public`,
 * unqualified, idempotent): a product that has them adopts version 1 with `adoptMigration`, no DDL. Version 1 is frozen once released.
 */
export const settingsSchema = defineModule({
  module: "settings",
  migrations: [
    {
      version: 1,
      name: "overrides_and_audit",
      sql: () => `
CREATE TABLE IF NOT EXISTS app_settings (
  scope      text NOT NULL CHECK (scope IN ('global', 'workspace', 'user')),
  scope_id   text NOT NULL DEFAULT '',
  key        text NOT NULL CHECK (key ~ '^[a-zA-Z0-9.]{1,80}$'),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (scope, scope_id, key),
  CHECK ((scope = 'global') = (scope_id = ''))
);
CREATE TABLE IF NOT EXISTS settings_audit (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_label text NOT NULL,
  scope       text NOT NULL,
  scope_id    text NOT NULL DEFAULT '',
  key         text NOT NULL,
  before      jsonb,
  after       jsonb
);
CREATE INDEX IF NOT EXISTS settings_audit_key ON settings_audit(key, id DESC);
`,
    },
  ],
});
