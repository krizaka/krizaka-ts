import { defineModule } from "@krizaka/db";

/**
 * The table of API keys, declared as a module (ADR-001 §3). Only a SHA-256 of the random part is kept; the public id finds the record.
 * A rotated-out key keeps working until `superseded_at` (its grace period); a revoked one stops at once. The one product table referenced
 * is the owner (`owner`: the product's account table), declared by the product.
 *
 * The table was created before the module schemas existed, so it stays in `public`, un-qualified: a product that has it adopts version 1
 * (`adoptMigration`, markers only) and one that does not emits it (`emitMigration`). Version 1 is frozen once released: a change is version 2.
 */
export const apiKeysSchema = defineModule({
  module: "api_keys",
  schema: "public",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "api keys",
      sql: (c) => `
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY,
  owner_id        uuid NOT NULL REFERENCES ${c.tables.owner}(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  public_id       text NOT NULL UNIQUE CHECK (public_id ~ '^[0-9a-f]{12}$'),
  secret_hash     text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes          text[] NOT NULL CHECK (cardinality(scopes) > 0),
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  rotated_from_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  superseded_at   timestamptz
);
CREATE INDEX api_keys_owner ON api_keys(owner_id, created_at);
`,
    },
  ],
});
