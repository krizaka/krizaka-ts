import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, type ModuleSchema } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { accountsMigration, accountsSchema, dbAccounts, postgresAccounts, rolesMigration, rolesSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const v1 = (schema: ModuleSchema, tables: Record<string, string>) => schema.migrations[0]!.sql({ schema: "public", tables });

/** The SHA-256 of what the old migration functions returned before the modules existed. */
const BEFORE = {
  accounts: "782f8dac201cf45eb31fd2789ce705a6867dbe8eeee8152b14c06d0a4b40ff29",
  accountsBackfill: "b52f9e609754969f70104a76f469db419eaf234f2127ade8abab6b65a7ad0f69",
  roles: "65d9c63772034c1c6a19dbf7c472f1a0bef302ae3d5946d4d8a1b30974ce0bfc",
  rolesScope: "10f0689f352be6d260ff57dfdbdb405006ec55f27fef3b0f1e95bb4809436fab",
};
const ROLES = ["owner", "member"];

describe("the auth schemas", () => {
  it("version 1 of the accounts module is byte-identical to the old migration", () => {
    expect(sha(v1(accountsSchema(), {}))).toBe(BEFORE.accounts);
    expect(sha(accountsMigration())).toBe(BEFORE.accounts);
    expect(sha(v1(accountsSchema({ backfillVerified: true }), {}))).toBe(BEFORE.accountsBackfill);
    expect(sha(accountsMigration({ backfillVerified: true }))).toBe(BEFORE.accountsBackfill);
    expect(checksumOf(accountsSchema(), 1, { tables: {} })).toBe(BEFORE.accounts);
  });

  it("version 1 of the roles module is byte-identical to the old migration", () => {
    expect(sha(v1(rolesSchema(ROLES), { owner: "accounts" }))).toBe(BEFORE.roles);
    expect(sha(rolesMigration(ROLES))).toBe(BEFORE.roles);
    expect(sha(v1(rolesSchema(ROLES, { scope: true }), { owner: "users", scope: "shops" }))).toBe(BEFORE.rolesScope);
    expect(sha(rolesMigration(ROLES, { ownerTable: "users", scopeTable: "shops" }))).toBe(BEFORE.rolesScope);
  });

  it("refuses an unsafe role or table name, and a scope table that is not declared", () => {
    expect(() => rolesSchema(["x'; DROP TABLE a; --"])).toThrow();
    expect(() => rolesMigration(ROLES, { ownerTable: "a;b" })).toThrow(/safe SQL identifier/);
    expect(() => emitMigration(rolesSchema(ROLES, { scope: true }), 1, { tables: { owner: "accounts" } })).toThrow(/scope/);
  });

  it("adopts existing tables with markers only", () => {
    const sql = adoptMigration(rolesSchema(ROLES), 1, { tables: { owner: "accounts" } });
    expect(sql).not.toContain("CREATE TABLE memberships");
    expect(sql).toContain("('auth_roles', 1,");
    expect(adoptMigration(accountsSchema(), 1, { tables: {} })).toContain("('auth', 1,");
  });

  it("keeps the old name as an alias", () => {
    expect(postgresAccounts).toBe(dbAccounts);
  });
});
