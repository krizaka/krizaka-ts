import { describe, expect, it } from "vitest";

import {
  BriefError,
  composeBrief,
  type Detector,
  type Guard,
  isBriefDue,
  type Recommendation,
  recommendation,
  weekOf,
} from "../src";

const WEEK = "2026-W43";
const rec = (kind: string, subject: string, impactCents: number, urgency: Recommendation["urgency"] = "week") =>
  recommendation({
    week: WEEK,
    kind,
    subject,
    urgency,
    impactCents,
    figures: { impactCents },
    action: { kind: "open", payload: subject },
  });

describe("recommendation", () => {
  it("gets a stable id from the week, the kind and the subject", () => {
    expect(rec("gaps", "thursday", 45000).id).toBe("2026-W43:gaps:thursday");
  });
  it("refuses money and figures that are not integers", () => {
    expect(() => rec("gaps", "x", 12.5)).toThrow(BriefError);
    expect(() =>
      recommendation({
        week: WEEK,
        kind: "k",
        subject: "s",
        urgency: "info",
        impactCents: 1,
        figures: { ratio: 0.42 },
        action: { kind: "a", payload: null },
      }),
    ).toThrow(/figure ratio/);
  });
  it("refuses a negative impact and a subject that would break the id", () => {
    expect(() => rec("gaps", "x", -1)).toThrow(/≥ 0/);
    expect(() => rec("gaps", "a:b", 1)).toThrow(/subject/);
  });
});

describe("composeBrief", () => {
  const detectors: Detector<{ consent: boolean }>[] = [
    () => [rec("pricing", "cut", 52000), rec("gaps", "thursday", 45000)],
    () => [rec("taxes", "shop", 54800, "now"), rec("channels", "fb", 1000, "info"), rec("gaps", "thursday", 1)],
  ];

  it("keeps the top three: urgency first, then the impact", () => {
    const brief = composeBrief({ week: WEEK, ctx: { consent: true }, detectors });
    expect(brief.items.map((i) => i.kind)).toEqual(["taxes", "pricing", "gaps"]);
    expect(brief.dropped.map((i) => i.kind)).toEqual(["channels"]);
  });

  it("keeps the first of two recommendations with the same id", () => {
    const brief = composeBrief({ week: WEEK, ctx: { consent: true }, detectors, limit: 10 });
    expect(brief.items.find((i) => i.kind === "gaps")?.impactCents).toBe(45000);
  });

  it("lets a guard veto with its reason, kept apart", () => {
    const falcon: Guard<{ consent: boolean }> = {
      name: "consent",
      check: (item, ctx) => (item.kind === "gaps" && !ctx.consent ? "NO_MARKETING_CONSENT" : null),
    };
    const brief = composeBrief({ week: WEEK, ctx: { consent: false }, detectors, guards: [falcon] });
    expect(brief.items.map((i) => i.kind)).toEqual(["taxes", "pricing", "channels"]);
    expect(brief.vetoed).toEqual([
      { item: expect.objectContaining({ kind: "gaps" }), guard: "consent", reason: "NO_MARKETING_CONSENT" },
    ]);
  });

  it("is deterministic: equal urgency and impact are ordered by id", () => {
    const a = composeBrief({ week: WEEK, ctx: null, detectors: [() => [rec("k", "b", 5), rec("k", "a", 5)]] });
    expect(a.items.map((i) => i.subject)).toEqual(["a", "b"]);
  });

  it("returns an empty brief when nothing is found", () => {
    expect(composeBrief({ week: WEEK, ctx: null, detectors: [() => []] })).toEqual({
      week: WEEK,
      items: [],
      vetoed: [],
      dropped: [],
    });
  });
});

describe("weekOf", () => {
  const zone = "America/Montreal";
  it("reads the week in the shop's zone, not UTC", () => {
    // Monday 2026-10-19 02:00 UTC is still Sunday evening in Montréal.
    expect(weekOf(new Date("2026-10-19T02:00:00Z"), zone)).toMatchObject({
      week: "2026-W42",
      localDate: "2026-10-18",
      weekday: 7,
      monday: "2026-10-12",
    });
    expect(weekOf(new Date("2026-10-22T15:00:00Z"), zone)).toEqual({
      week: "2026-W43",
      monday: "2026-10-19",
      localDate: "2026-10-22",
      weekday: 4,
      hour: 11,
    });
  });
  it("crosses the year with the ISO rules", () => {
    expect(weekOf(new Date("2027-01-01T17:00:00Z"), zone)).toMatchObject({ week: "2026-W53", monday: "2026-12-28" });
    expect(weekOf(new Date("2025-12-29T17:00:00Z"), zone)).toMatchObject({ week: "2026-W01", monday: "2025-12-29" });
  });
  it("holds across the autumn time change", () => {
    expect(weekOf(new Date("2026-11-01T06:30:00Z"), zone)).toMatchObject({
      localDate: "2026-11-01",
      hour: 1,
      weekday: 7,
    });
    expect(weekOf(new Date("2026-11-02T12:00:00Z"), zone)).toMatchObject({
      localDate: "2026-11-02",
      hour: 7,
      weekday: 1,
      week: "2026-W45",
    });
  });
});

describe("isBriefDue", () => {
  const zone = "America/Montreal";
  it("is due from Monday 7:00 local, once a week", () => {
    expect(isBriefDue(new Date("2026-10-19T10:59:00Z"), zone, "2026-W42")).toBe(false); // 6:59
    expect(isBriefDue(new Date("2026-10-19T11:00:00Z"), zone, "2026-W42")).toBe(true); // 7:00
    expect(isBriefDue(new Date("2026-10-19T11:00:00Z"), zone, "2026-W43")).toBe(false); // already sent
  });
  it("still sends later in the week when Monday was missed", () => {
    expect(isBriefDue(new Date("2026-10-21T15:00:00Z"), zone, null)).toBe(true);
  });
  it("follows a shop's own day and hour", () => {
    expect(isBriefDue(new Date("2026-10-19T13:00:00Z"), zone, null, { weekday: 2, hour: 8 })).toBe(false);
    expect(isBriefDue(new Date("2026-10-20T12:00:00Z"), zone, null, { weekday: 2, hour: 8 })).toBe(true);
  });
});
