import { emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { dbVisitStore, weeklyCampaignVisits, weeklyVisits } from "../src";
import { visitsSchema } from "../src/schema";

describe("the SQL", () => {
  it("emits a table with no column that could hold a person", () => {
    const sql = emitMigration(visitsSchema, 1, { tables: {} });
    expect(sql).toMatch(/visit_counts/);
    expect(sql).toMatch(/PRIMARY KEY \(site, page, day, referrer_domain\)/);
    expect(sql).not.toMatch(/\b(ip|user_agent|cookie|session|visitor)\b/i);
  });

  it("version 2 adds the two utm columns, bounded, and puts them in the key", () => {
    const sql = emitMigration(visitsSchema, 2, { tables: {} });
    expect(sql).toMatch(/utm_source\s+text NOT NULL DEFAULT '' CHECK \(char_length\(utm_source\) <= 64\)/);
    expect(sql).toMatch(/utm_campaign\s+text NOT NULL DEFAULT '' CHECK \(char_length\(utm_campaign\) <= 64\)/);
    expect(sql).toMatch(/PRIMARY KEY \(site, page, day, referrer_domain, utm_source, utm_campaign\)/);
    expect(sql).not.toMatch(/\b(ip|user_agent|cookie|session|visitor|url)\b/i);
  });

  it("counts in one parameterised statement carrying the cap, and tells whether it wrote", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const store = dbVisitStore(async (sql, params) => (calls.push({ sql, params: params ?? [] }), [{}]) as never);
    expect(
      await store.count(
        { site: "www", page: "/", day: "2026-11-17", referrerDomain: "", utmSource: "x", utmCampaign: "c1" },
        5,
      ),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(["www", "/", "2026-11-17", "", "x", "c1", 5]);
    expect(calls[0]!.sql).toMatch(/ON CONFLICT/);
    const dropped = dbVisitStore(async () => [] as never);
    expect(
      await dropped.count(
        { site: "www", page: "/", day: "2026-11-17", referrerDomain: "", utmSource: "", utmCampaign: "" },
        5,
      ),
    ).toBe(false);
  });

  it("reads weekly counts per page as numbers", async () => {
    const rows = await weeklyVisits(
      async () => [{ week: "2026-11-16", page: "/fr", count: "12" }] as never,
      "www",
      "2026-11-01",
    );
    expect(rows).toEqual([{ week: "2026-11-16", page: "/fr", count: 12 }]);
  });

  it("reads weekly counts per campaign as numbers", async () => {
    const calls: unknown[][] = [];
    const rows = await weeklyCampaignVisits(
      async (_sql, params) =>
        (calls.push(params ?? []),
        [{ week: "2026-11-16", utm_source: "x", utm_campaign: "c1", page: "/fr", count: "3" }]) as never,
      "www",
      "2026-11-01",
    );
    expect(rows).toEqual([{ week: "2026-11-16", utmSource: "x", utmCampaign: "c1", page: "/fr", count: 3 }]);
    expect(calls[0]).toEqual(["www", "2026-11-01"]);
  });

  it("refuses an unsafe schema name and keeps the main entry free of imports", async () => {
    expect(() => dbVisitStore(async () => [], { schema: "visits; DROP TABLE x" })).toThrow(/VISITS_UNSAFE_IDENTIFIER/);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../src/store.ts", import.meta.url), "utf8")).not.toMatch(/^import /m);
  });
});
