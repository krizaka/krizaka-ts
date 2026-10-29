import { defineModule } from "@krizaka/db";

/**
 * The tables of the settings, declared as modules (ADR-001 §3). They existed before the module schemas, so they stay in `public`,
 * un-qualified: a product that has them adopts version 1 (`adoptMigration`, markers only), one that does not emits it. Version 1 of
 * each is frozen once released: a change is version 2. (`settings` moves to its own schema in its next major, because of the
 * `app_settings` collision with another product.)
 */

/** The overrides (global, for a workspace, for one user: the most specific wins) and the audit of every change (who, what, when, before, after). Idempotent. */
export const settingsSchema = defineModule({
  module: "settings",
  schema: "public",
  migrations: [
    {
      version: 1,
      name: "overrides and audit",
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

/** The price versions of the catalogue: rows are only ever added, a version once sold is never rewritten. Each insert writes its line in `settings_audit`. */
export const pricesSchema = defineModule({
  module: "settings_prices",
  schema: "public",
  requires: ["settings"],
  migrations: [
    {
      version: 1,
      name: "price versions",
      sql: () => `
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
`,
    },
  ],
});
