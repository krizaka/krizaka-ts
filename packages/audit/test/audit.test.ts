import { describe, expect, it } from "vitest";

import { AUDIT_CODE, AuditError, auditSettings, createAudit, memoryAuditStore } from "../src";
import { auditStoreContract } from "../src/testkit";

const clock = (iso: string) => ({ now: () => new Date(iso) });

describe("recording", () => {
  it("records who did what, when, with the clock's time", async () => {
    const store = memoryAuditStore();
    const audit = createAudit({ storeFor: () => store, clock: clock("2026-10-23T10:00:00Z") });
    await audit.record(async () => [], {
      actorId: "a1",
      actorLabel: "Eric",
      action: "billing.checkout_started",
      target: { type: "account", id: "a1" },
      detail: { kind: "pro" },
      ip: "203.0.113.4",
    });
    const [entry] = await audit.list(async () => [], {});
    expect(entry).toMatchObject({
      actorId: "a1",
      actorLabel: "Eric",
      action: "billing.checkout_started",
      targetType: "account",
      targetId: "a1",
      detail: { kind: "pro" },
      ip: "203.0.113.4",
    });
    expect(entry!.at.toISOString()).toBe("2026-10-23T10:00:00.000Z");
  });

  it("refuses a malformed action or label, and an action outside the product's list when it gives one", async () => {
    const audit = createAudit({
      storeFor: () => memoryAuditStore(),
      clock: clock("2026-10-23T10:00:00Z"),
      allowedActions: ["admin.user_suspended"],
    });
    await expect(
      audit.record(async () => [], { actorId: null, actorLabel: "system", action: "Not An Action" }),
    ).rejects.toMatchObject({ code: AUDIT_CODE.badAction });
    await expect(
      audit.record(async () => [], { actorId: null, actorLabel: "", action: "admin.user_suspended" }),
    ).rejects.toMatchObject({ code: AUDIT_CODE.badLabel });
    await expect(
      audit.record(async () => [], { actorId: null, actorLabel: "system", action: "admin.other" }),
    ).rejects.toBeInstanceOf(AuditError);
  });

  it("records quietly: a failure is reported, never thrown", async () => {
    const errors: unknown[] = [];
    const broken = {
      ...memoryAuditStore(),
      insert: async () => {
        throw new Error("database down");
      },
    };
    const audit = createAudit({
      storeFor: () => broken,
      clock: clock("2026-10-23T10:00:00Z"),
      onError: (e) => {
        errors.push(e);
      },
    });
    await expect(
      audit.recordQuietly(async () => [], { actorId: null, actorLabel: "system", action: "jobs.ran" }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("purges what is older than the retention the admin set", async () => {
    const store = memoryAuditStore();
    const at = (iso: string) => createAudit({ storeFor: () => store, clock: clock(iso) });
    await at("2023-01-01T00:00:00Z").record(async () => [], {
      actorId: null,
      actorLabel: "system",
      action: "old.thing",
    });
    await at("2026-10-01T00:00:00Z").record(async () => [], {
      actorId: null,
      actorLabel: "system",
      action: "new.thing",
    });
    expect(await at("2026-10-23T00:00:00Z").purge(async () => [], { retentionDays: 1095 })).toBe(1);
    expect((await at("2026-10-23T00:00:00Z").list(async () => [], {})).map((e) => e.action)).toEqual(["new.thing"]);
  });
});

describe("the settings fragment", () => {
  it("declares the retention with its default and bounds, for the admin", () => {
    expect(auditSettings["audit.retentionDays"]).toMatchObject({
      kind: "integer",
      default: 1095,
      min: 30,
      max: 3650,
      unit: "days",
    });
  });
});

describe("the memory store", () => {
  auditStoreContract(
    "memory",
    () => memoryAuditStore(),
    (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );
});
