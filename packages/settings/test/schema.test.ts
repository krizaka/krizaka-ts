import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration, MARKER_TABLE } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { pricesMigration, pricesSchema, settingsMigration, settingsSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** SHA-256 of what the old functions returned before the module schemas existed (recorded from that code). */
const BEFORE = { settings: "051524285802ef38f829227d81f34935afd8999c2f83be821d25b1f6078ac7a1", prices: "e23b50329e7ef5e4bb974c6cc8b4e94a8edc37d97288d24ca72a26401429c5ed" };
const context = { schema: "public", tables: {} };

describe("the settings schemas", () => {
  it("version 1 is byte-identical to the SQL shipped before the module schemas", () => {
    expect(sha(settingsSchema.migrations[0]!.sql(context))).toBe(BEFORE.settings);
    expect(sha(settingsSchema.migrations[0]!.sql(context) + pricesSchema.migrations[0]!.sql(context))).toBe(BEFORE.prices);
  });

  it("keeps the old functions as wrappers over version 1", () => {
    expect(sha(settingsMigration())).toBe(BEFORE.settings);
    expect(sha(pricesMigration())).toBe(BEFORE.prices);
  });

  it("is frozen, in `public`, and the prices need the settings first", () => {
    expect(checksumOf(settingsSchema, 1, { tables: {} })).toBe(BEFORE.settings);
    expect(pricesSchema.requires).toEqual(["settings"]);
    expect(emitMigration(settingsSchema, 1, { tables: {} })).toContain("CREATE TABLE IF NOT EXISTS app_settings");
    const adopted = adoptMigration(settingsSchema, 1, { tables: {} });
    expect(adopted).not.toContain("CREATE TABLE IF NOT EXISTS app_settings");
    expect(adopted).toContain(`('settings', 1, '${BEFORE.settings}')`);
    expect(adoptMigration(pricesSchema, 1, { tables: {} })).toContain(MARKER_TABLE);
  });
});
