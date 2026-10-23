import { accountsSchema, rolesSchema } from "./schema";

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${name}`);
  return name;
};

/**
 * What the account adapter needs from a product's database, for a product that applies it by hand.
 * `backfillVerified`: for accounts that exist already, treat the address as verified (invitation-only products).
 * @deprecated use `accountsSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`; the SQL is the same.
 */
export function accountsMigration(options: { backfillVerified?: boolean } = {}): string {
  return accountsSchema(options).migrations[0]!.sql({ schema: "public", tables: {} });
}

/**
 * Memberships and invitations, for a product that applies them by hand. `scopeTable` is the table of the scope: when given, a membership
 * and an invitation point at it. Idempotent.
 * @deprecated use `rolesSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`; the SQL is the same.
 */
export function rolesMigration(roles: readonly string[], options: { ownerTable?: string; scopeTable?: string } = {}): string {
  const owner = ident(options.ownerTable ?? "accounts");
  const tables: Record<string, string> = { owner };
  if (options.scopeTable) tables.scope = ident(options.scopeTable);
  roles.forEach(ident);
  return rolesSchema(roles, { scope: Boolean(options.scopeTable) }).migrations[0]!.sql({ schema: "public", tables });
}
