import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, MARKER_TABLE } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { apiKeysMigration, apiKeysSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** SHA-256 of what `apiKeysMigration(…)` returned before the module schema existed (recorded from that code): the proof that akinaza and yomizaka adopt with no DDL change. */
const BEFORE = { default: "65a8c2cee01432a016cb553fb8f9765e39a9fe51f1ad30bfab7693120a65ac20", users: "e4ac93b2e82d800720cad21879c05e60eeb7e1b255e958a8c1747431ffc0920d" };

describe("the API keys schema", () => {
  it("version 1 is byte-identical to the SQL shipped before the module schema", () => {
    expect(sha(apiKeysSchema.migrations[0]!.sql({ schema: "public", tables: { owner: "accounts" } }))).toBe(BEFORE.default);
    expect(sha(apiKeysSchema.migrations[0]!.sql({ schema: "public", tables: { owner: "users" } }))).toBe(BEFORE.users);
  });

  it("keeps the old function as a wrapper over version 1, with its old refusal", () => {
    expect(sha(apiKeysMigration())).toBe(BEFORE.default);
    expect(sha(apiKeysMigration("users"))).toBe(BEFORE.users);
    expect(() => apiKeysMigration("users; DROP TABLE x")).toThrow("not a safe SQL identifier");
  });

  it("is frozen: version 1's checksum is the hash of the old SQL, and a product emits or adopts it in `public`", () => {
    const context = { tables: { owner: "accounts" } };
    expect(checksumOf(apiKeysSchema, 1, context)).toBe(BEFORE.default);
    expect(emitMigration(apiKeysSchema, 1, context)).toContain("CREATE TABLE api_keys (");
    expect(emitMigration(apiKeysSchema, 1, context)).toContain("CREATE SCHEMA IF NOT EXISTS public;");
    const adopted = adoptMigration(apiKeysSchema, 1, context);
    expect(adopted).not.toContain("CREATE TABLE api_keys");
    expect(adopted).toContain(`INSERT INTO ${MARKER_TABLE}`);
    expect(adopted).toContain(`('api_keys', 1, '${BEFORE.default}')`);
  });

  it("references only the declared owner table, and refuses an unsafe name", () => {
    expect(() => emitMigration(apiKeysSchema, 1, { tables: {} })).toThrow(/owner/);
    expect(() => emitMigration(apiKeysSchema, 1, { tables: { owner: "users; DROP TABLE x" } })).toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
