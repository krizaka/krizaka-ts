import { describe, expect, it } from "vitest";

import { AUDIT_CODE, createAudit, dbAuditStore, memoryAuditStore } from "../src";

/** Inputs that reach the trail from an HTTP request must be refused the same way by every store, before any SQL. */
const audit = createAudit({ storeFor: () => memoryAuditStore(), clock: { now: () => new Date("2026-10-23T10:00:00Z") } });
const none = async () => [];

describe("the admin's filters are checked before any store", () => {
  it("refuses a page size that is not a positive integer, and caps a large one", async () => {
    for (const limit of [0, -1, 2.5, Number.NaN, "50; DROP TABLE x" as unknown as number]) {
      await expect(audit.list(none, { limit })).rejects.toMatchObject({ code: AUDIT_CODE.badFilter });
    }
    const sql: string[] = [];
    const params: unknown[][] = [];
    await dbAuditStore(async (text, values) => { sql.push(text); params.push([...(values ?? [])]); return []; }).list({ limit: 10_000 });
    expect(sql[0]).not.toContain("10000");
    expect(params[0]).toContain(200);
  });

  it("refuses a cursor that is not an entry id", async () => {
    await expect(audit.list(none, { before: "abc" })).rejects.toMatchObject({ code: AUDIT_CODE.badFilter });
  });
});

describe("what is recorded is checked the same way for every store", () => {
  it("refuses an IP that is not an address", async () => {
    await expect(audit.record(none, { actorId: null, actorLabel: "system", action: "x.y", ip: "not-an-ip" })).rejects.toMatchObject({ code: AUDIT_CODE.badIp });
    await expect(audit.record(none, { actorId: null, actorLabel: "system", action: "x.y", ip: "2001:db8::1" })).resolves.toBeUndefined();
  });
});

describe("retention", () => {
  it("refuses a retention outside the setting's bounds (30 to 3650 days), so a bad value never purges everything", async () => {
    for (const retentionDays of [-1, 0, 29, 3651, 1.5]) {
      await expect(audit.purge(none, { retentionDays })).rejects.toMatchObject({ code: AUDIT_CODE.badRetention });
    }
  });
});
