import { describe, expect, it } from "vitest";

import {
  BUCKET,
  CREDITS_DEFAULTS,
  type Grant,
  type GrantState,
  ON_EXHAUSTED,
  planDraws,
  skipFirst,
  uuidOf,
} from "../src";
import { checkAmount, checkKey, checkSettings } from "../src/rules";
import { creditsSettings, readCreditsSettings } from "../src/settings";

const NOW = new Date("2026-10-26T16:00:00.000Z");
const state = (id: string, over: Partial<Grant> = {}, remaining = 5, extra: Partial<GrantState> = {}): GrantState => ({
  grant: {
    id,
    accountId: "a",
    bucket: BUCKET.granted,
    amount: remaining,
    capPerDay: null,
    capPerMonth: null,
    expiresAt: new Date("2026-11-26T00:00:00Z"),
    onExhausted: ON_EXHAUSTED.stop,
    source: "s",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  },
  remaining,
  usedToday: 0,
  usedThisMonth: 0,
  closed: false,
  ...extra,
});

describe("planDraws", () => {
  it("covers the whole amount or refuses; it never plans half", () => {
    expect(planDraws([state("a", {}, 3)], 4, NOW)).toEqual({ ok: false, code: "CREDITS_EXHAUSTED" });
    expect(planDraws([state("a", {}, 3)], 3, NOW)).toEqual({ ok: true, draws: [{ grantId: "a", amount: 3 }] });
  });
  it("is deterministic on ties: the same expiry goes by creation, then by id", () => {
    const a = state("b", { createdAt: new Date("2026-10-02T00:00:00Z") });
    const b = state("a", { createdAt: new Date("2026-10-02T00:00:00Z") });
    const c = state("c", { createdAt: new Date("2026-10-01T00:00:00Z") });
    expect(planDraws([a, b, c], 15, NOW)).toEqual({
      ok: true,
      draws: [
        { grantId: "c", amount: 5 },
        { grantId: "a", amount: 5 },
        { grantId: "b", amount: 5 },
      ],
    });
  });
  it("skips lapsed, closed and empty pots", () => {
    const lapsed = state("l", { expiresAt: NOW });
    const closed = state("c", {}, 5, { closed: true });
    const empty = state("e", { onExhausted: ON_EXHAUSTED.fallbackPaid }, 0);
    expect(planDraws([lapsed, closed, empty], 1, NOW)).toEqual({ ok: false, code: "PAYWALL" });
  });
  it("a cap names day or month by which binds first, and purchased credits do not bypass it", () => {
    const day = state("d", { capPerDay: 1, capPerMonth: 10 });
    const month = state("m", { capPerDay: 10, capPerMonth: 1 });
    const paid = state("p", { bucket: BUCKET.purchased, expiresAt: null, capPerDay: null }, 50);
    expect(planDraws([day, paid], 2, NOW)).toEqual({ ok: false, code: "CREDITS_CAP_DAY" });
    expect(planDraws([month, paid], 2, NOW)).toEqual({ ok: false, code: "CREDITS_CAP_MONTH" });
    expect(planDraws([{ ...day, usedToday: 1 }], 1, NOW)).toEqual({ ok: false, code: "CREDITS_CAP_DAY" });
  });
  it("a cap that is not reached by the amount asked does not refuse", () => {
    expect(planDraws([state("d", { capPerDay: 3 })], 3, NOW)).toEqual({
      ok: true,
      draws: [{ grantId: "d", amount: 3 }],
    });
  });
  it("purchased credits go oldest first", () => {
    const old = state(
      "o",
      { bucket: BUCKET.purchased, expiresAt: null, createdAt: new Date("2026-01-01T00:00:00Z") },
      2,
    );
    const young = state(
      "y",
      { bucket: BUCKET.purchased, expiresAt: null, createdAt: new Date("2026-06-01T00:00:00Z") },
      9,
    );
    expect(planDraws([young, old], 3, NOW)).toEqual({
      ok: true,
      draws: [
        { grantId: "o", amount: 2 },
        { grantId: "y", amount: 1 },
      ],
    });
  });
});

describe("skipFirst", () => {
  const draws = [
    { grantId: "a", amount: 3 },
    { grantId: "b", amount: 2 },
  ];
  it("drops the credits already held back, in order", () => {
    expect(skipFirst(draws, 0)).toEqual(draws);
    expect(skipFirst(draws, 2)).toEqual([
      { grantId: "a", amount: 1 },
      { grantId: "b", amount: 2 },
    ]);
    expect(skipFirst(draws, 3)).toEqual([{ grantId: "b", amount: 2 }]);
    expect(skipFirst(draws, 5)).toEqual([]);
  });
});

describe("the checks", () => {
  it("amounts are positive safe integers", () => {
    expect(checkAmount(3)).toBe(3);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => checkAmount(bad)).toThrow(expect.objectContaining({ code: "CREDITS_BAD_AMOUNT", status: 400 }));
  });
  it("keys are printable, short, and carry no colon (the line keys are `<key>:<n>`)", () => {
    expect(checkKey("job_1-a.b")).toBe("job_1-a.b");
    for (const bad of ["", "a b", "a:b", "x".repeat(151), "é"])
      expect(() => checkKey(bad)).toThrow(expect.objectContaining({ code: "CREDITS_BAD_KEY" }));
  });
  it("settings: a real IANA zone and a hold lifetime inside the bounds", () => {
    expect(checkSettings(CREDITS_DEFAULTS)).toEqual(CREDITS_DEFAULTS);
    expect(() => checkSettings({ ...CREDITS_DEFAULTS, timeZone: "Mars/Olympus" })).toThrow(
      expect.objectContaining({ code: "CREDITS_BAD_SETTINGS", status: 500 }),
    );
    expect(() => checkSettings({ ...CREDITS_DEFAULTS, holdTtlSeconds: 5 })).toThrow(/30 to 86400/);
    expect(() => checkSettings({ ...CREDITS_DEFAULTS, holdTtlSeconds: 86_401 })).toThrow(/30 to 86400/);
  });
});

describe("the settings fragment", () => {
  it("registers the zone (from the runtime's list) and the hold lifetime", async () => {
    expect(creditsSettings["credits.timeZone"]).toMatchObject({ default: "America/Toronto", kind: "choice" });
    expect(creditsSettings["credits.timeZone"].choices).toContain("America/Toronto");
    expect(creditsSettings["credits.holdTtlSeconds"]).toMatchObject({ default: 900, min: 30, max: 86_400 });
    expect(await readCreditsSettings(() => undefined)).toEqual(CREDITS_DEFAULTS);
    expect(await readCreditsSettings((k: string) => (k === "credits.timeZone" ? "Europe/Paris" : 120))).toEqual({
      timeZone: "Europe/Paris",
      holdTtlSeconds: 120,
    });
  });
});

describe("event ids", () => {
  it("uuidOf is a stable version-5-shaped UUID", () => {
    expect(uuidOf("granted:1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidOf("x")).toBe(uuidOf("x"));
    expect(uuidOf("x")).not.toBe(uuidOf("y"));
  });
});
