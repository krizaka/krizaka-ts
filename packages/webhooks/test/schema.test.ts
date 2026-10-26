import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { webhooksMigration, webhooksSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** SHA-256 of what `webhooksMigration(…)` returned before the module schema existed (recorded from that code). */
const BEFORE = { default: "f7850a9284262b6daffebc41540647ccae5cc6ea7842fdd765fbf3b483d751e9", users: "b0268a0228482081200f133208560a52ce0dfac232985104d5fc6429e5a17746" };

describe("the webhooks schema", () => {
  it("version 1 is byte-identical to the SQL shipped before the module schema", () => {
    expect(sha(webhooksSchema.migrations[0]!.sql({ schema: "public", tables: { owner: "accounts" } }))).toBe(BEFORE.default);
    expect(sha(webhooksSchema.migrations[0]!.sql({ schema: "public", tables: { owner: "users" } }))).toBe(BEFORE.users);
  });

  it("keeps the old function as a wrapper over version 1, with its old refusal", () => {
    expect(sha(webhooksMigration())).toBe(BEFORE.default);
    expect(sha(webhooksMigration("users"))).toBe(BEFORE.users);
    expect(() => webhooksMigration("users; DROP TABLE x")).toThrow("not a safe SQL identifier");
  });

  it("is frozen: the checksum is the hash of the old SQL, and a product adopts it as a marker with no DDL", () => {
    const context = { tables: { owner: "accounts" } };
    expect(checksumOf(webhooksSchema, 1, context)).toBe(BEFORE.default);
    expect(emitMigration(webhooksSchema, 1, context)).toContain("CREATE TABLE IF NOT EXISTS webhook_endpoints");
    const adopted = adoptMigration(webhooksSchema, 1, context);
    expect(adopted).not.toContain("CREATE TABLE IF NOT EXISTS webhook_endpoints");
    expect(adopted).toContain(`('webhooks', 1, '${BEFORE.default}')`);
    expect(() => emitMigration(webhooksSchema, 1, { tables: {} })).toThrow(/owner/);
  });
});
