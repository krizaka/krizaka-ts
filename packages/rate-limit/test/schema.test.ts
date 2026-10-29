import { adoptMigration, checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { rateLimitSchema } from "../src";

const context = { tables: {} };

describe("the rate-limit schema", () => {
  it("lives in its own Postgres schema, references no product table, and may be renamed by the product", () => {
    const sql = emitMigration(rateLimitSchema, 1, context);
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS rate_limit;");
    expect(sql).toContain("CREATE TABLE rate_limit.bucket");
    expect(sql).toContain("key          text PRIMARY KEY");
    expect(emitMigration(rateLimitSchema, 1, { ...context, schema: "kz_limits" })).toContain(
      "CREATE TABLE kz_limits.bucket",
    );
    expect(rateLimitSchema.tables).toEqual([]);
  });

  it("version 1 is frozen: its SQL never changes after release (a change is version 2)", () => {
    expect(checksumOf(rateLimitSchema, 1, context)).toBe(FROZEN_V1);
    expect(adoptMigration(rateLimitSchema, 1, context)).toContain(FROZEN_V1);
  });
});

/** Recorded when version 1 was released. Changing it means editing a released migration: add a version instead. */
const FROZEN_V1 = "bc01c8c8d3e2f8bc88a27440ddecdaf473fd2ec9f787cfae329d980b65fe29a0";
