import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, type ModuleSchema } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { webhooksMigration, webhooksSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const v1 = (schema: ModuleSchema, tables: Record<string, string>) => schema.migrations[0]!.sql({ schema: "public", tables });

/** The SHA-256 of what `webhooksMigration("accounts")` returned before the module existed. */
const BEFORE = "f7850a9284262b6daffebc41540647ccae5cc6ea7842fdd765fbf3b483d751e9";

describe("the webhooks schema", () => {
  it("version 1 is byte-identical to the old migration", () => {
    expect(sha(v1(webhooksSchema, { owner: "accounts" }))).toBe(BEFORE);
    expect(sha(webhooksMigration("accounts"))).toBe(BEFORE);
    expect(checksumOf(webhooksSchema, 1, { tables: { owner: "accounts" } })).toBe(BEFORE);
    expect(v1(webhooksSchema, { owner: "users" })).toBe(webhooksMigration("users"));
  });

  it("adopts existing tables with markers only, and emits the same SQL for a new database", () => {
    const context = { tables: { owner: "accounts" } };
    expect(adoptMigration(webhooksSchema, 1, context)).not.toContain("webhook_endpoints");
    expect(adoptMigration(webhooksSchema, 1, context)).toContain("('webhooks', 1,");
    expect(emitMigration(webhooksSchema, 1, context)).toContain(webhooksMigration("accounts").trim());
  });
});
