import { defineModule, type ModuleSchema } from "@krizaka/db";

/**
 * The tables of « auth », declared as modules (ADR-001 §3). They are added to a product's own `accounts` and `sessions` tables, which
 * existed before the module schemas: they stay in `public`, un-qualified, and a product that has them adopts version 1
 * (`adoptMigration`, markers only) while one that does not emits it (`emitMigration`). Version 1 of each is frozen once released:
 * a change is version 2. The one product table every one of them references is declared by the product (`accounts`, `owner`).
 */

/**
 * What the account adapter needs from a product's database, safe to run on a database that already has `accounts` and `sessions`:
 * a display name, a theme, an avatar seed, the verified-address flag, and the table of e-mail changes (a link mailed to the NEW
 * address) and the table of password resets (a link mailed to the account's address). `accounts` needs `id`, `email`, `locale`, `password_hash`;
 * `sessions` needs `account_id`, `created_at`, `expires_at`, `ip`, `user_agent`.
 * @param options `backfillVerified`: for accounts that exist already, treat the address as verified (invitation-only products)
 */
export function accountsSchema(options: { backfillVerified?: boolean } = {}): ModuleSchema {
  return defineModule({
    module: "auth",
    schema: "public",
    tables: ["accounts"],
    migrations: [
      {
        version: 1,
        name: "accounts profile, e-mail changes, password resets",
        sql: (c) => `
ALTER TABLE ${c.tables.accounts} ADD COLUMN IF NOT EXISTS name text CHECK (name IS NULL OR char_length(name) <= 80);
ALTER TABLE ${c.tables.accounts} ADD COLUMN IF NOT EXISTS avatar_seed text CHECK (avatar_seed IS NULL OR avatar_seed ~ '^[a-z0-9-]{1,40}$');
ALTER TABLE ${c.tables.accounts} ADD COLUMN IF NOT EXISTS theme text CHECK (theme IS NULL OR theme IN ('light', 'dark', 'system'));
ALTER TABLE ${c.tables.accounts} ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
${options.backfillVerified ? `UPDATE ${c.tables.accounts} SET email_verified_at = created_at WHERE email_verified_at IS NULL;\n` : ""}CREATE TABLE IF NOT EXISTS email_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ${c.tables.accounts}(id) ON DELETE CASCADE,
  new_email  text NOT NULL CHECK (new_email = lower(new_email)),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE TABLE IF NOT EXISTS password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ${c.tables.accounts}(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
`,
      },
    ],
  });
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${name}`);
  return name;
};

/**
 * Memberships (who has which role in which scope) and invitations (an e-mail address invited with a role, by a link used once), from the
 * product's role model. Declares the account table (`owner`) and, when the roles are scoped, the scope table (`scope`: shops, workspaces):
 * a membership and an invitation then point at it. Idempotent.
 * @param roles the role names of the model: each becomes a value of the `role` check, so each must be a safe identifier
 * @param options `scoped`: true when the product declares a `scope` table
 * @throws Error for a role that is not a safe SQL identifier
 */
export function rolesSchema(roles: readonly string[], options: { scoped?: boolean } = {}): ModuleSchema {
  const list = roles.map((r) => `'${ident(r)}'`).join(", ");
  return defineModule({
    module: "auth_roles",
    schema: "public",
    tables: options.scoped ? ["owner", "scope"] : ["owner"],
    migrations: [
      {
        version: 1,
        name: "memberships and invitations",
        sql: (c) => {
          const scope = options.scoped ? ` REFERENCES ${c.tables.scope}(id) ON DELETE CASCADE` : "";
          return `
CREATE TABLE IF NOT EXISTS memberships (
  scope_id   uuid NOT NULL${scope},
  account_id uuid NOT NULL REFERENCES ${c.tables.owner}(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN (${list})),
  invited_by uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope_id, account_id)
);
CREATE INDEX IF NOT EXISTS memberships_account ON memberships(account_id);
CREATE TABLE IF NOT EXISTS invitations (
  id         uuid PRIMARY KEY,
  scope_id   uuid NOT NULL${scope},
  email      text NOT NULL CHECK (email = lower(email)),
  role       text NOT NULL CHECK (role IN (${list})),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_scope ON invitations(scope_id) WHERE used_at IS NULL;
`;
        },
      },
    ],
  });
}

/** Which external identity belongs to which account (federated sign-in): `(issuer, subject) → account`, never a second user table. Idempotent. */
export const identityLinksSchema = defineModule({
  module: "auth_identity_links",
  schema: "public",
  tables: ["accounts"],
  migrations: [
    {
      version: 1,
      name: "external identities",
      sql: (c) => `
CREATE TABLE IF NOT EXISTS external_identities (
  issuer     text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 200),
  subject    text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  account_id uuid NOT NULL REFERENCES ${c.tables.accounts}(id) ON DELETE CASCADE,
  linked_at  timestamptz NOT NULL,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS external_identities_account ON external_identities(account_id, linked_at);
`,
    },
  ],
});
