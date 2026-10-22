/**
 * What the account adapter needs from a product's database, safe to run on a database that already has `accounts` and `sessions`:
 * a display name, a theme, an avatar seed, the verified-address flag, and the table of e-mail changes (a link mailed to the NEW
 * address). `accounts` needs `id`, `email`, `locale`, `password_hash`; `sessions` needs `account_id`, `created_at`, `expires_at`, `ip`, `user_agent`.
 * `backfillVerified`: for accounts that exist already, treat the address as verified (invitation-only products).
 */
export function accountsMigration(options: { backfillVerified?: boolean } = {}): string {
  return `
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
`;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${name}`);
  return name;
};

/**
 * Memberships (who has which role in which scope) and invitations (an e-mail address invited with a role, by a link used once), from the
 * product's role model. `scopeTable` is the table of the scope (shops, workspaces): when given, a membership and an invitation point at it.
 * Idempotent.
 */
export function rolesMigration(roles: readonly string[], options: { ownerTable?: string; scopeTable?: string } = {}): string {
  const owner = ident(options.ownerTable ?? "accounts");
  const scope = options.scopeTable ? ` REFERENCES ${ident(options.scopeTable)}(id) ON DELETE CASCADE` : "";
  const list = roles.map((r) => `'${ident(r)}'`).join(", ");
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
}
