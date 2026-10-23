import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, type ModuleSchema } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { dbSettings, postgresSettings, settingsMigration, settingsSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const v1 = (schema: ModuleSchema, tables: Record<string, string>) => schema.migrations[0]!.sql({ schema: "public", tables });

/** The SHA-256 of what `settingsMigration()` returned before the module existed. */
const BEFORE = "051524285802ef38f829227d81f34935afd8999c2f83be821d25b1f6078ac7a1";

describe("the settings schema", () => {
  it("version 1 is byte-identical to the old migration", () => {
    expect(sha(v1(settingsSchema, {}))).toBe(BEFORE);
    expect(sha(settingsMigration())).toBe(BEFORE);
    expect(checksumOf(settingsSchema, 1, { tables: {} })).toBe(BEFORE);
  });

  it("adopts existing tables with markers only, and emits the same SQL for a new database", () => {
    expect(adoptMigration(settingsSchema, 1, { tables: {} })).not.toContain("app_settings");
    expect(adoptMigration(settingsSchema, 1, { tables: {} })).toContain("('settings', 1,");
    expect(emitMigration(settingsSchema, 1, { tables: {} })).toContain(settingsMigration().trim());
  });

  it("keeps the old name as an alias", () => {
    expect(postgresSettings).toBe(dbSettings);
  });
});
