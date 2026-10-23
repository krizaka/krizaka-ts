import { DB_CODE } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { AUDIT_CODE, createAudit, dbAuditStore, memoryAuditStore } from "../src";

/** Regression tests for the review of #65 (krizaka-ts#52). */
const clock = { now: () => new Date("2026-10-23T10:00:00Z") };
const none = async () => [];

describe("the database store checks its schema name itself", () => {
  it("refuses an unsafe schema when built directly, before any SQL", () => {
    let calls = 0;
    expect(() => dbAuditStore(async () => { calls++; return []; }, "audit; DROP TABLE x")).toThrow(expect.objectContaining({ code: DB_CODE.unsafeIdentifier }));
    expect(calls).toBe(0);
  });
});

describe("recordQuietly never throws, even when the error sink fails", () => {
  const broken = { ...memoryAuditStore(), insert: async () => { throw new Error("database down"); } };

  it("a sink that throws is swallowed", async () => {
    const audit = createAudit({ storeFor: () => broken, clock, onError: () => { throw new Error("logger down"); } });
    await expect(audit.recordQuietly(none, { actorId: null, actorLabel: "system", action: "x.y" })).resolves.toBeUndefined();
  });

  it("a sink that rejects is awaited and swallowed (no unhandled rejection)", async () => {
    const audit = createAudit({ storeFor: () => broken, clock, onError: async () => { throw new Error("logger down"); } });
    await expect(audit.recordQuietly(none, { actorId: null, actorLabel: "system", action: "x.y" })).resolves.toBeUndefined();
  });
});

describe("a cursor beyond PostgreSQL's bigint is refused like any bad cursor", () => {
  it("accepts the largest bigint and refuses the next one", async () => {
    const audit = createAudit({ storeFor: () => memoryAuditStore(), clock });
    await expect(audit.list(none, { before: "9223372036854775807" })).resolves.toEqual([]);
    await expect(audit.list(none, { before: "9223372036854775808" })).rejects.toMatchObject({ code: AUDIT_CODE.badFilter });
  });
});
