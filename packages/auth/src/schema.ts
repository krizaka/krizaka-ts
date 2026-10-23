import { DB_CODE, DbError, defineModule, type ModuleSchema } from "@krizaka/db";

/**
 * What the account adapter needs from a product's database, as a versioned module (ADR-001 §3), safe to run on a database that already
 * has `accounts` and `sessions`: a display name, a theme, an avatar seed, the verified-address flag, and the table of e-mail changes (a
 * link mailed to the NEW address). `accounts` needs `id`, `email`, `locale`, `password_hash`; `sessions` needs `account_id`, `created_at`,
 * `expires_at`, `ip`, `user_agent`. The tables stay in `public`: a product that has them adopts version 1 with `adoptMigration`, no DDL.
 * `backfillVerified`: for accounts that exist already, treat the address as verified (invitation-only products).
 */
export function accountsSchema(options: { backfillVerified?: boolean } = {}): ModuleSchema {
  return defineModule({
    module: "auth",
    migrations: [
      {
        version: 1,
        name: "accounts",
        sql: () => `
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name text CHECK (name IS NULL OR char_length(name) <= 80);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_seed text CHECK (avatar_seed IS NULL OR avatar_seed ~ '^[a-z0-9-]{1,40}$');
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS theme text CHECK (theme IS NULL OR theme IN ('light', 'dark', 'system'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
${options.backfillVerified ? "UPDATE accounts SET email_verified_at = created_at WHERE email_verified_at IS NULL;\n" : ""}CREATE TABLE IF NOT EXISTS email_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  new_email  text NOT NULL CHECK (new_email = lower(new_email)),
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

const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Memberships (who has which role in which scope) and invitations (an e-mail address invited with a role, by a link used once), from the
 * product's role model, as a versioned module. The product declares its account table as `owner` and, when roles are scoped, its scope
 * table (shops, workspaces) as `scope`: a membership and an invitation then point at it. Idempotent; the tables stay in `public`.
 * @param roles the role names of the product's model
 * @param options `scope: true` when the product declares a `scope` table
 * @throws DbError `DB_UNSAFE_IDENTIFIER` for a role that is not a safe SQL identifier
 */
export function rolesSchema(roles: readonly string[], options: { scope?: boolean } = {}): ModuleSchema {
  const bad = roles.filter((r) => !ROLE.test(r));
  if (bad.length > 0) throw new DbError(DB_CODE.unsafeIdentifier, bad);
  const list = roles.map((r) => `'${r}'`).join(", ");
  return defineModule({
    module: "auth_roles",
    tables: options.scope ? ["owner", "scope"] : ["owner"],
    migrations: [
      {
        version: 1,
        name: "memberships_and_invitations",
        sql: (c) => {
          const owner = c.tables.owner;
          const scope = options.scope ? ` REFERENCES ${c.tables.scope}(id) ON DELETE CASCADE` : "";
          return `
CREATE TABLE IF NOT EXISTS memberships (
  scope_id   uuid NOT NULL${scope},
  account_id uuid NOT NULL REFERENCES ${owner}(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN (${list})),
  invited_by uuid REFERENCES ${owner}(id) ON DELETE SET NULL,
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
  invited_by uuid REFERENCES ${owner}(id) ON DELETE SET NULL,
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
