import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import {
  accountsMigration,
  accountsSchema,
  identityLinksMigration,
  identityLinksSchema,
  rolesMigration,
  rolesSchema,
  sessionsSchema,
} from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** SHA-256 of what the old functions returned before the module schemas existed (recorded from that code). */
const BEFORE = {
  accounts: "a48bf5bf2db6f001d588c012447f75ea8fd3d57f049debd1ba1de801dc037628",
  accountsBackfill: "9f47697aa60c1667c8454deaefbc4641787e6e74d70a527359f2c6cc7f95e74f",
  roles: "65d9c63772034c1c6a19dbf7c472f1a0bef302ae3d5946d4d8a1b30974ce0bfc",
  rolesScoped: "3516c51da62b591c9d510d6fd9aa9f195ddd8941147650c7924d499adf95b55b",
  links: "83d8bb842770b2832c8fda063913bc075404c02f1bc71bf258a04d8e30f97b39",
};
const accounts = { schema: "public", tables: { accounts: "accounts" } };

describe("the auth schemas", () => {
  it("version 1 of each is byte-identical to the SQL shipped before the module schemas", () => {
    expect(sha(accountsSchema().migrations[0]!.sql(accounts))).toBe(BEFORE.accounts);
    expect(sha(accountsSchema({ backfillVerified: true }).migrations[0]!.sql(accounts))).toBe(BEFORE.accountsBackfill);
    expect(
      sha(rolesSchema(["owner", "member"]).migrations[0]!.sql({ schema: "public", tables: { owner: "accounts" } })),
    ).toBe(BEFORE.roles);
    expect(
      sha(
        rolesSchema(["owner", "manager", "staff"], { scoped: true }).migrations[0]!.sql({
          schema: "public",
          tables: { owner: "users", scope: "shops" },
        }),
      ),
    ).toBe(BEFORE.rolesScoped);
    expect(sha(identityLinksSchema.migrations[0]!.sql(accounts))).toBe(BEFORE.links);
  });

  it("keeps the old functions as wrappers over version 1", () => {
    expect(sha(accountsMigration())).toBe(BEFORE.accounts);
    expect(sha(accountsMigration({ backfillVerified: true }))).toBe(BEFORE.accountsBackfill);
    expect(sha(rolesMigration(["owner", "member"]))).toBe(BEFORE.roles);
    expect(sha(rolesMigration(["owner", "manager", "staff"], { ownerTable: "users", scopeTable: "shops" }))).toBe(
      BEFORE.rolesScoped,
    );
    expect(sha(identityLinksMigration())).toBe(BEFORE.links);
    expect(() => rolesMigration(["owner'; DROP TABLE x; --"])).toThrow("not a safe SQL identifier");
  });

  it("is frozen: the checksums are the hashes of the old SQL, and a product adopts them as markers with no DDL", () => {
    expect(checksumOf(accountsSchema(), 1, { tables: { accounts: "accounts" } })).toBe(BEFORE.accounts);
    const adopted = adoptMigration(accountsSchema(), 1, { tables: { accounts: "accounts" } });
    expect(adopted).not.toContain("ALTER TABLE");
    expect(adopted).toContain(`('auth', 1, '${BEFORE.accounts}')`);
    expect(emitMigration(identityLinksSchema, 1, { tables: { accounts: "accounts" } })).toContain(
      "CREATE TABLE IF NOT EXISTS external_identities",
    );
  });

  it("the scoped roles declare the scope table, and the unscoped ones do not need it", () => {
    expect(() => emitMigration(rolesSchema(["owner"], { scoped: true }), 1, { tables: { owner: "accounts" } })).toThrow(
      /scope/,
    );
    expect(emitMigration(rolesSchema(["owner"]), 1, { tables: { owner: "accounts" } })).not.toContain(
      "REFERENCES undefined",
    );
  });

  it("the sessions table is a module in `public`, with the shape the products' own table has", () => {
    const sql = emitMigration(sessionsSchema, 1, { tables: { accounts: "accounts" } });
    for (const needle of [
      "CREATE TABLE IF NOT EXISTS sessions",
      "token_hash   text NOT NULL UNIQUE",
      "REFERENCES accounts(id) ON DELETE CASCADE",
      "CREATE INDEX IF NOT EXISTS sessions_account",
      "('auth_sessions', 1, ",
    ])
      expect(sql).toContain(needle);
    expect(adoptMigration(sessionsSchema, 1, { tables: { accounts: "accounts" } })).not.toContain("sessions (");
  });
});
