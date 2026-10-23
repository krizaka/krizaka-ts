import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, type ModuleSchema } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { organizeMigration, organizeModuleSchema, type OrganizeSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const v1 = (schema: ModuleSchema, tables: Record<string, string>) => schema.migrations[0]!.sql({ schema: "public", tables });

/** The SHA-256 of what `organizeMigration(DECLARATION)` returned before the module existed. */
const BEFORE = "7420bc74da0fe2ec2d035b3b584be45c9c3b6d0118b80f38ef0f275bb18ab4ce";
const DECLARATION: OrganizeSchema = { kinds: { recipe: { table: "recipes" }, note: { table: "notes", inCollection: false } } };

describe("the organize schema", () => {
  it("version 1 is byte-identical to the old migration", () => {
    const schema = organizeModuleSchema(DECLARATION);
    expect(sha(v1(schema, {}))).toBe(BEFORE);
    expect(sha(organizeMigration(DECLARATION))).toBe(BEFORE);
    expect(checksumOf(schema, 1, { tables: {} })).toBe(BEFORE);
  });

  it("adopts existing tables with markers only, and emits the same SQL for a new database", () => {
    const schema = organizeModuleSchema(DECLARATION);
    expect(adoptMigration(schema, 1, { tables: {} })).not.toContain("recipes");
    expect(adoptMigration(schema, 1, { tables: {} })).toContain("('organize', 1,");
    expect(emitMigration(schema, 1, { tables: {} })).toContain(organizeMigration(DECLARATION).trim());
  });
});
