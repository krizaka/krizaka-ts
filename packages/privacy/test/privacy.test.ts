import { describe, expect, it } from "vitest";

import {
  auditContributor,
  createPrivacy,
  memoryPrivacyStore,
  PRIVACY_CODE,
  type PrivacyContributor,
  type PrivacyDeps,
  type Query,
  type Subject,
} from "../src";
import { privacyStoreContract } from "../src/testkit";

const noQuery: Query = async () => [];
const ERIC: Subject = { kind: "account", id: "a1" };
const NOW = new Date("2026-10-26T12:00:00.000Z");

/** Two sample contributors holding data about people, as a product's modules would. */
function sample() {
  const orders = new Map<string, string[]>([
    ["a1", ["order-1", "order-2"]],
    ["a2", ["order-3"]],
  ]);
  const notes = new Map<string, string>([
    ["a1", "likes cats"],
    ["a2", "likes dogs"],
  ]);
  const purged: string[] = [];
  const contributors: PrivacyContributor[] = [
    {
      name: "orders",
      exportFor: async (_q, s) => orders.get(s.id) ?? [],
      eraseFor: async (_tx, s) => void orders.delete(s.id),
      purgeExpired: async (_tx, { purpose, before }) => (purged.push(`orders:${purpose}:${before.toISOString()}`), 2),
    },
    {
      name: "notes",
      exportFor: async (_q, s) => ({ note: notes.get(s.id) ?? null }),
      eraseFor: async (_tx, s) => void notes.delete(s.id),
    },
  ];
  return { contributors, orders, notes, purged };
}

function setup(over: Partial<PrivacyDeps> = {}) {
  const store = memoryPrivacyStore();
  const data = sample();
  const audited: unknown[] = [];
  const privacy = createPrivacy({
    clock: { now: () => NOW },
    contributors: data.contributors,
    purposes: ["marketing", "screening", "payment-history"],
    transaction: (work) => work(noQuery),
    storeFor: () => store,
    audit: { record: async (_q, entry) => void audited.push(entry) },
    ...over,
  });
  return { privacy, store, audited, ...data };
}

describe("consents", () => {
  it("records a consent with the notice version, the means and the instant; the last word wins", async () => {
    const { privacy } = setup();
    expect(await privacy.hasConsent(noQuery, ERIC, "marketing")).toBe(false); // never said anything: not consented
    await privacy.recordConsent(noQuery, {
      subject: ERIC,
      purpose: "marketing",
      version: "2026-10-01",
      granted: true,
      means: "checkbox",
    });
    expect(await privacy.hasConsent(noQuery, ERIC, "marketing")).toBe(true);
    await privacy.recordConsent(noQuery, {
      subject: ERIC,
      purpose: "marketing",
      version: "2026-10-01",
      granted: false,
      means: "link",
    });
    expect(await privacy.hasConsent(noQuery, ERIC, "marketing")).toBe(false);
    const history = await privacy.consentHistory(noQuery, ERIC);
    expect(history.map((c) => [c.granted, c.means, c.version])).toEqual([
      [true, "checkbox", "2026-10-01"],
      [false, "link", "2026-10-01"],
    ]);
    expect(history[0]!.at.toISOString()).toBe(NOW.toISOString());
  });

  it("refuses a purpose the product did not declare, a malformed subject or purpose, and an empty notice version", async () => {
    const { privacy } = setup();
    const ok = { subject: ERIC, purpose: "marketing", version: "v1", granted: true };
    await expect(privacy.recordConsent(noQuery, { ...ok, purpose: "selling-your-data" })).rejects.toMatchObject({
      code: PRIVACY_CODE.badPurpose,
    });
    await expect(privacy.recordConsent(noQuery, { ...ok, purpose: "Marketing" })).rejects.toMatchObject({
      code: PRIVACY_CODE.badPurpose,
    });
    await expect(
      privacy.recordConsent(noQuery, { ...ok, subject: { kind: "Account", id: "a1" } }),
    ).rejects.toMatchObject({ code: PRIVACY_CODE.badSubject });
    await expect(privacy.recordConsent(noQuery, { ...ok, subject: { kind: "account", id: "" } })).rejects.toMatchObject(
      { code: PRIVACY_CODE.badSubject },
    );
    await expect(privacy.recordConsent(noQuery, { ...ok, version: "" })).rejects.toMatchObject({
      code: PRIVACY_CODE.badConsent,
    });
  });

  it("refuses to be built with a purpose that is not well formed, or two contributors of the same name", () => {
    expect(() => setup({ purposes: ["Bad Purpose"] })).toThrow(/purpose/);
    const { contributors } = sample();
    expect(() => setup({ contributors: [contributors[0]!, contributors[0]!] })).toThrow(/same name/);
  });
});

describe("export", () => {
  it("assembles one document with a part per contributor, and records the request as completed", async () => {
    const { privacy } = setup();
    const document = await privacy.exportSubject(noQuery, ERIC);
    expect(document).toEqual({
      format: 1,
      subject: ERIC,
      generatedAt: NOW.toISOString(),
      modules: { orders: ["order-1", "order-2"], notes: { note: "likes cats" } },
    });
    expect(await privacy.requests(noQuery, ERIC)).toMatchObject([
      { kind: "export", status: "completed", failure: null },
    ]);
  });

  it("fails as a whole when a contributor fails, naming it, and records the failure as a code", async () => {
    const { contributors } = sample();
    const broken: PrivacyContributor = {
      name: "files",
      exportFor: async () => {
        throw new Error("storage down");
      },
      eraseFor: async () => undefined,
    };
    const { privacy } = setup({ contributors: [...contributors, broken] });
    await expect(privacy.exportSubject(noQuery, ERIC)).rejects.toMatchObject({
      code: PRIVACY_CODE.contributorFailed,
      message: expect.stringContaining("files"),
    });
    expect(await privacy.requests(noQuery, ERIC)).toMatchObject([
      { kind: "export", status: "failed", failure: "CONTRIBUTOR_FAILED" },
    ]);
  });

  it("a large export is asked in the caller's transaction, through the outbox, and fulfilled by a worker", async () => {
    const appended: { topic: string; type: string; payload: unknown; id?: string }[] = [];
    const { privacy } = setup({ outbox: { append: async (_tx, message) => void appended.push(message) } });
    const { requestId } = await privacy.requestExport(noQuery, ERIC);
    expect(appended).toEqual([
      { topic: "privacy", type: "evt.privacy.export_requested.v1", payload: { requestId }, id: requestId },
    ]); // the id only, no personal data
    const delivered: unknown[] = [];
    await privacy.fulfilExport(noQuery, requestId, async (document) => void delivered.push(document));
    expect(delivered).toMatchObject([{ subject: ERIC, modules: { orders: ["order-1", "order-2"] } }]);
    expect(await privacy.requests(noQuery, ERIC)).toMatchObject([{ id: requestId, status: "completed" }]);
    await expect(privacy.fulfilExport(noQuery, requestId, async () => undefined)).rejects.toMatchObject({
      code: PRIVACY_CODE.alreadyDone,
    });
    await expect(
      privacy.fulfilExport(noQuery, "00000000-0000-4000-8000-000000000000", async () => undefined),
    ).rejects.toMatchObject({ code: PRIVACY_CODE.unknownRequest });
  });

  it("marks a fulfilment failed when the delivery fails, and can be asked again", async () => {
    const { privacy } = setup({ outbox: { append: async () => undefined } });
    const { requestId } = await privacy.requestExport(noQuery, ERIC);
    await expect(
      privacy.fulfilExport(noQuery, requestId, async () => {
        throw new Error("mail down");
      }),
    ).rejects.toThrow("mail down");
    expect(await privacy.requests(noQuery, ERIC)).toMatchObject([{ status: "failed" }]);
  });

  it("needs the outbox for an asynchronous export, and says so", async () => {
    const { privacy } = setup();
    await expect(privacy.requestExport(noQuery, ERIC)).rejects.toMatchObject({ code: PRIVACY_CODE.noOutbox });
  });
});

describe("erasure", () => {
  it("with two sample contributors, an export contains both, and an erasure leaves neither", async () => {
    const { privacy, orders, notes } = setup();
    expect(Object.keys((await privacy.exportSubject(noQuery, ERIC)).modules)).toEqual(["orders", "notes"]);
    await privacy.eraseSubject(ERIC);
    expect(orders.has("a1")).toBe(false);
    expect(notes.has("a1")).toBe(false);
    expect(orders.get("a2")).toEqual(["order-3"]); // someone else's data is untouched
    expect(notes.get("a2")).toBe("likes dogs");
    expect((await privacy.exportSubject(noQuery, ERIC)).modules).toEqual({ orders: [], notes: { note: null } });
  });

  it("withdraws the live consents, records the request, and writes an audit entry that names no one", async () => {
    const { privacy, audited } = setup();
    const who: Subject = { kind: "account", id: "person-zq81-secret-id" };
    await privacy.recordConsent(noQuery, { subject: who, purpose: "marketing", version: "v1", granted: true });
    await privacy.recordConsent(noQuery, { subject: who, purpose: "screening", version: "v1", granted: false });
    const request = await privacy.eraseSubject(who, { noticeVersion: "2026-10-26" });
    expect(request).toMatchObject({ kind: "erasure", status: "completed" });
    expect(await privacy.hasConsent(noQuery, who, "marketing")).toBe(false);
    const history = await privacy.consentHistory(noQuery, who);
    expect(history.map((c) => [c.purpose, c.granted, c.version, c.means])).toEqual([
      ["marketing", true, "v1", null],
      ["screening", false, "v1", null],
      ["marketing", false, "2026-10-26", "erasure"],
    ]);
    expect(audited).toEqual([
      {
        actorId: null,
        actorLabel: "privacy",
        action: "privacy.erasure_completed",
        target: { type: "privacy_request", id: request.id },
        detail: { contributors: ["orders", "notes"] },
      },
    ]);
    expect(JSON.stringify(audited)).not.toContain(who.id);
  });

  it("when a contributor fails, throws its error, records the failure as a code, and does not report an audit entry", async () => {
    const { contributors } = sample();
    const broken: PrivacyContributor = {
      name: "files",
      exportFor: async () => ({}),
      eraseFor: async () => {
        throw new Error("storage down");
      },
    };
    const { privacy, audited, store } = setup({ contributors: [...contributors, broken] });
    const error = await privacy.eraseSubject(ERIC).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: PRIVACY_CODE.contributorFailed });
    expect((error as Error).cause).toMatchObject({ message: "storage down" });
    expect(audited).toEqual([]);
    expect(await store.requestsOf(ERIC)).toMatchObject([
      { kind: "erasure", status: "failed", failure: "CONTRIBUTOR_FAILED" },
    ]);
  });

  it("does not mask the original error when recording the failure fails too", async () => {
    const { contributors } = sample();
    const broken: PrivacyContributor = {
      name: "files",
      exportFor: async () => ({}),
      eraseFor: async () => {
        throw new Error("storage down");
      },
    };
    let calls = 0;
    const { privacy } = setup({
      contributors: [...contributors, broken],
      transaction: async (work) => {
        calls += 1;
        if (calls === 2) throw new Error("db gone");
        return work(noQuery);
      },
    });
    const error = await privacy.eraseSubject(ERIC).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toMatchObject({ code: PRIVACY_CODE.contributorFailed }); // the original first
    expect((error as AggregateError).errors[1]).toMatchObject({ message: "db gone" });
  });

  it("the audit contributor exports the actor's entries and detaches them, for the subjects of its kind only", async () => {
    const calls: string[] = [];
    const contributor = auditContributor({
      exportFor: async (_q, id) => (calls.push(`export:${id}`), [{ action: "x" }]),
      redactActor: async (_q, id) => (calls.push(`redact:${id}`), 1),
    });
    expect(await contributor.exportFor(noQuery, ERIC)).toEqual([{ action: "x" }]);
    await contributor.eraseFor(noQuery, ERIC);
    expect(await contributor.exportFor(noQuery, { kind: "client", id: "c1" })).toEqual([]);
    await contributor.eraseFor(noQuery, { kind: "client", id: "c1" });
    expect(calls).toEqual(["export:a1", "redact:a1"]);
  });
});

describe("retention", () => {
  it("asks each contributor to remove what is past the retention of each purpose that has one", async () => {
    const days: Record<string, number> = { marketing: 365, screening: 30 };
    const { privacy, purged } = setup({ retentionDays: (purpose) => days[purpose] });
    expect(await privacy.purge(noQuery)).toEqual({ marketing: 2, screening: 2 }); // payment-history has no retention: left alone
    expect(purged).toEqual(["orders:marketing:2025-10-26T12:00:00.000Z", "orders:screening:2026-09-26T12:00:00.000Z"]);
  });

  it("refuses a retention that is not a whole number of days from 1", async () => {
    for (const bad of [0, -1, 1.5])
      await expect(setup({ retentionDays: () => bad }).privacy.purge(noQuery)).rejects.toThrow(RangeError);
  });
});

describe("the memory store", () => {
  privacyStoreContract("memory", () => memoryPrivacyStore());
});
