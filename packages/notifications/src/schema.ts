import { defineModule } from "@krizaka/db";

/**
 * The tables of « notifications », in their own Postgres schema: `item` (the bell, and the history the burst caps count), `preference`
 * (the account's explicit choices: account by category by channel) and `device` (the push tokens). The one product table referenced is
 * the owner (`owner`, the account table): a deleted account takes its rows with it. Version 1 is frozen once released: a change is version 2.
 */
export const notificationsSchema = defineModule({
  module: "notifications",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "items, preferences and devices",
      sql: (c) => `
CREATE TABLE ${c.schema}.item (
  id         uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES ${c.tables.owner}(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category ~ '^[a-z][a-zA-Z0-9]{0,39}$'),
  template   text NOT NULL CHECK (template ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  payload    jsonb NOT NULL,
  dedupe_key text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 200),
  in_bell    boolean NOT NULL,
  created_at timestamptz NOT NULL,
  read_at    timestamptz
);
CREATE UNIQUE INDEX item_dedupe ON ${c.schema}.item (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX item_bell ON ${c.schema}.item (account_id, created_at DESC, id DESC) WHERE in_bell;
CREATE INDEX item_burst ON ${c.schema}.item (account_id, category, created_at);
CREATE INDEX item_created ON ${c.schema}.item (created_at);
CREATE TABLE ${c.schema}.preference (
  account_id uuid NOT NULL REFERENCES ${c.tables.owner}(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category ~ '^[a-z][a-zA-Z0-9]{0,39}$'),
  channel    text NOT NULL CHECK (channel IN ('app', 'push', 'email')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, category, channel)
);
CREATE TABLE ${c.schema}.device (
  id           uuid PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES ${c.tables.owner}(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token        text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 1 AND 4096),
  created_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX device_account ON ${c.schema}.device (account_id) WHERE revoked_at IS NULL;`,
    },
  ],
});
