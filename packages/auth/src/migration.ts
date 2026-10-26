import { accountsSchema, rolesSchema } from "./schema";

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const ident = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${name}`);
  return name;
};

/**
 * The SQL of version 1 of the accounts tables, for a product that runs it by hand (idempotent).
 * @deprecated Use `accountsSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`: the SQL gets a version, a checksum and a marker. Removed in the next major.
 */
export function accountsMigration(options: { backfillVerified?: boolean } = {}): string {
  return accountsSchema(options).migrations[0]!.sql({ schema: "public", tables: { accounts: "accounts" } });
}

/**
 * The SQL of version 1 of the memberships and invitations tables, for a product that runs it by hand (idempotent).
 * @deprecated Use `rolesSchema` with `emitMigration` or `adoptMigration` from `@krizaka/db`. Removed in the next major.
 */
export function rolesMigration(roles: readonly string[], options: { ownerTable?: string; scopeTable?: string } = {}): string {
  const tables = { owner: ident(options.ownerTable ?? "accounts"), ...(options.scopeTable ? { scope: ident(options.scopeTable) } : {}) };
  return rolesSchema(roles, { scoped: options.scopeTable !== undefined }).migrations[0]!.sql({ schema: "public", tables });
}
