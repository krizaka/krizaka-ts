import { adoptMigration, checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { privacySchema } from "../src";

const context = { tables: {} };

describe("the privacy schema", () => {
  it("lives in its own Postgres schema, references no product table, writes a consent once and keeps the request apart", () => {
    const sql = emitMigration(privacySchema, 1, context);
    for (const needle of ["CREATE SCHEMA IF NOT EXISTS privacy;", "CREATE TABLE privacy.consent", "CREATE TABLE privacy.request", "BEFORE UPDATE ON privacy.consent", "a consent is written once", "seq          bigserial UNIQUE"]) expect(sql).toContain(needle);
    expect(emitMigration(privacySchema, 1, { ...context, schema: "kz_privacy" })).toContain("CREATE TABLE kz_privacy.consent");
    expect(privacySchema.tables).toEqual([]);
  });

  it("version 2 adds the incident register, guarded against deleting before retention and editing once closed", () => {
    const sql = emitMigration(privacySchema, 2, context);
    for (const needle of ["CREATE TABLE privacy.incident", "retain_until", "stays in the register until its retention ends", "a closed entry of the register is never edited", "BEFORE UPDATE OR DELETE ON privacy.incident"]) expect(sql).toContain(needle);
  });

  it("version 1 is frozen: its SQL never changes after release (a change is version 2)", () => {
    expect(checksumOf(privacySchema, 1, context)).toBe(FROZEN_V1);
    expect(adoptMigration(privacySchema, 1, context)).toContain(FROZEN_V1);
  });
});

/** Recorded when version 1 was released. Changing it means editing a released migration: add a version instead. */
const FROZEN_V1 = "1c0fbc2cedba58b2034b666555621389230bfef102dd6b5f7fcf54302a6d3464";
