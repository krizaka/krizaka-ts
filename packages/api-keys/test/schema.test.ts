import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, type ModuleSchema } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { apiKeysMigration, apiKeysSchema, dbApiKeyStore, pgApiKeyStore } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const v1 = (schema: ModuleSchema, tables: Record<string, string>) => schema.migrations[0]!.sql({ schema: "public", tables });

/** The SHA-256 of what `apiKeysMigration("accounts")` returned before the module existed: akinaza and yomizaka adopt with no DDL change. */
const BEFORE = "65a8c2cee01432a016cb553fb8f9765e39a9fe51f1ad30bfab7693120a65ac20";

describe("the api-keys schema", () => {
  it("version 1 is byte-identical to the old migration", () => {
    expect(sha(v1(apiKeysSchema, { owner: "accounts" }))).toBe(BEFORE);
    expect(sha(apiKeysMigration("accounts"))).toBe(BEFORE);
    expect(checksumOf(apiKeysSchema, 1, { tables: { owner: "accounts" } })).toBe(BEFORE);
    expect(v1(apiKeysSchema, { owner: "users" })).toBe(apiKeysMigration("users"));
  });

  it("adopts existing tables with markers only, and emits the same SQL for a new database", () => {
    const context = { tables: { owner: "accounts" } };
    expect(adoptMigration(apiKeysSchema, 1, context)).not.toContain("CREATE TABLE api_keys");
    expect(adoptMigration(apiKeysSchema, 1, context)).toContain("('api_keys', 1,");
    expect(emitMigration(apiKeysSchema, 1, context)).toContain(apiKeysMigration("accounts").trim());
  });

  it("keeps the old names as aliases", () => {
    expect(pgApiKeyStore).toBe(dbApiKeyStore);
  });
});
