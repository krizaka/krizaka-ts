import { checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { auditSchema } from "../src";

const context = { tables: { owner: "accounts" } };

describe("the audit schema", () => {
  it("lives in its own Postgres schema and references only the declared owner table", () => {
    const sql = emitMigration(auditSchema, 1, context);
    expect(sql).toContain("CREATE TABLE audit.entry");
    expect(sql).toContain("REFERENCES accounts(id) ON DELETE SET NULL");
    expect(() => emitMigration(auditSchema, 1, { tables: {} })).toThrow(/owner/);
  });

  it("version 1 is frozen: its SQL never changes after release (a change is version 2)", () => {
    expect(checksumOf(auditSchema, 1, context)).toBe(FROZEN_V1);
  });
});

/** Recorded when version 1 was released. Changing it means editing a released migration: add a version instead. */
const FROZEN_V1 = "0a4bb651cf3e6b34f99bc29b22944e7ef7da1a1ce28df02807b45ca51cbf722d";
