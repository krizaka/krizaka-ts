import { emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { dbVisitStore, weeklyVisits } from "../src";
import { visitsSchema } from "../src/schema";

describe("the SQL", () => {
  it("emits a table with no column that could hold a person", () => {
    const sql = emitMigration(visitsSchema, 1, { tables: {} });
    expect(sql).toMatch(/visit_counts/);
    expect(sql).toMatch(/PRIMARY KEY \(site, page, day, referrer_domain\)/);
    expect(sql).not.toMatch(/\b(ip|user_agent|cookie|session|visitor)\b/i);
  });

  it("counts in one parameterised statement carrying the cap, and tells whether it wrote", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const store = dbVisitStore(async (sql, params) => (calls.push({ sql, params: params ?? [] }), [{}]) as never);
    expect(await store.count({ site: "www", page: "/", day: "2026-11-17", referrerDomain: "" }, 5)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(["www", "/", "2026-11-17", "", 5]);
    expect(calls[0]!.sql).toMatch(/ON CONFLICT/);
    const dropped = dbVisitStore(async () => [] as never);
    expect(await dropped.count({ site: "www", page: "/", day: "2026-11-17", referrerDomain: "" }, 5)).toBe(false);
  });

  it("reads weekly counts per page as numbers", async () => {
    const rows = await weeklyVisits(
      async () => [{ week: "2026-11-16", page: "/fr", count: "12" }] as never,
      "www",
      "2026-11-01",
    );
    expect(rows).toEqual([{ week: "2026-11-16", page: "/fr", count: 12 }]);
  });

  it("refuses an unsafe schema name and keeps the main entry free of imports", async () => {
    expect(() => dbVisitStore(async () => [], { schema: "visits; DROP TABLE x" })).toThrow(/VISITS_UNSAFE_IDENTIFIER/);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../src/store.ts", import.meta.url), "utf8")).not.toMatch(/^import /m);
  });
});
