import { describe, expect, it } from "vitest";

import {
  countsAsUse,
  type Coupon,
  COUPON_DEFAULTS,
  effectOf,
  generateCode,
  normalizeCode,
  refusalOf,
  termsOf,
} from "../src";
import { checkSettings } from "../src/rules";
import { COUPON_ATTEMPT_ACTION, couponAttemptLimit, couponSettings, readCouponSettings } from "../src/settings";

const NOW = new Date("2026-10-26T16:00:00.000Z");
const base: Coupon = {
  id: "c",
  code: "PROMO2026",
  codeKey: "PROMO2026",
  kind: "discount",
  purpose: "promo",
  partnerId: null,
  status: "active",
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: null,
  maxRedemptions: null,
  maxPerAccount: 1,
  newCustomersOnly: false,
  plans: [],
  percentOffBp: 1000,
  amountOffMinor: null,
  currency: null,
  duration: "once",
  durationMonths: null,
  minimumMinor: null,
  credits: null,
  capPerDay: null,
  capPerMonth: null,
  creditsValidDays: null,
  onExhausted: null,
  termsVersion: 1,
  createdAt: NOW,
  createdBy: null,
  updatedAt: NOW,
};
const ctx = { mode: "checkout" as const, accountId: "a", plan: "pro", amountMinor: 1000, currency: "cad" };
const none = { total: 0, account: 0 };

describe("normalizeCode", () => {
  it("reads a code without case, spaces, hyphens or underscores", () => {
    expect(normalizeCode(" Summer-2026 ")).toBe("SUMMER2026");
    expect(normalizeCode("sum mer_20 26")).toBe("SUMMER2026");
    expect(normalizeCode("ＳＵＭＭＥＲ")).toBe("SUMMER");
  });
  it("refuses what is empty, too long or not letters and digits", () => {
    for (const bad of ["", "   ", "a".repeat(41), "bad!code", "é-é"]) expect(normalizeCode(bad)).toBeNull();
    expect(normalizeCode("a".repeat(40))).toHaveLength(40);
  });
});

describe("generateCode", () => {
  it("draws from an alphabet without I, L, O and U, of the length asked", () => {
    const code = generateCode(2000);
    expect(code).toHaveLength(2000);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    expect(new Set(code).size).toBe(32);
  });
  it("takes its randomness from the function it is given", () => {
    expect(generateCode(3, () => 0)).toBe("000");
    expect(generateCode(2, (max) => max - 1)).toBe("ZZ");
  });
});

describe("countsAsUse: the one rule of the limits", () => {
  const r = (status: string, extra: object = {}) =>
    ({ status, useRestored: false, reservedUntil: null, ...extra }) as never;
  it("confirmed and revoked count unless restored; reserved counts until its deadline; released never", () => {
    expect(countsAsUse(r("confirmed"), NOW)).toBe(true);
    expect(countsAsUse(r("revoked"), NOW)).toBe(true);
    expect(countsAsUse(r("confirmed", { useRestored: true }), NOW)).toBe(false);
    expect(countsAsUse(r("reserved", { reservedUntil: new Date(NOW.valueOf() + 1) }), NOW)).toBe(true);
    expect(countsAsUse(r("reserved", { reservedUntil: NOW }), NOW)).toBe(false);
    expect(countsAsUse(r("reserved"), NOW)).toBe(false);
    expect(countsAsUse(r("released"), NOW)).toBe(false);
  });
});

describe("refusalOf", () => {
  const refusal = (c: Partial<Coupon>, over: object = {}, usage = none, settings = COUPON_DEFAULTS) =>
    refusalOf({ ...base, ...c }, { ...ctx, ...over }, usage, NOW, settings);
  it("follows the table's order", () => {
    expect(refusal({})).toBeNull();
    expect(refusal({ startsAt: new Date(NOW.valueOf() + 1), status: "paused" })).toBe("COUPON_NOT_STARTED");
    expect(refusal({ endsAt: NOW, status: "paused" })).toBe("COUPON_EXPIRED");
    expect(refusal({ status: "paused", maxRedemptions: 1 }, {}, { total: 1, account: 1 })).toBe("COUPON_PAUSED");
    expect(refusal({ maxRedemptions: 1 }, {}, { total: 1, account: 1 })).toBe("COUPON_EXHAUSTED");
    expect(refusal({}, {}, { total: 1, account: 1 })).toBe("COUPON_ACCOUNT_LIMIT");
    expect(refusal({ maxPerAccount: 2 }, {}, { total: 1, account: 1 })).toBeNull();
    expect(refusal({ newCustomersOnly: true }, { hasPaidBefore: true })).toBe("COUPON_NEW_CUSTOMERS_ONLY");
  });
  it("the bound on a discount is the setting's, for a percentage and for an amount", () => {
    expect(refusal({ percentOffBp: 5000 })).toBeNull();
    expect(refusal({ percentOffBp: 5001 })).toBe("COUPON_TOO_LARGE");
    expect(refusal({ percentOffBp: null, amountOffMinor: 500, currency: "cad" })).toBeNull();
    expect(refusal({ percentOffBp: null, amountOffMinor: 501, currency: "cad" })).toBe("COUPON_TOO_LARGE");
    expect(
      refusal({ percentOffBp: null, amountOffMinor: 501, currency: "cad" }, {}, none, {
        ...COUPON_DEFAULTS,
        maxPercentOff: 60,
      }),
    ).toBeNull();
  });
  it("a credit code is for redeeming, a discount code for checkout", () => {
    expect(
      refusal({ kind: "credit", credits: 5, creditsValidDays: 5, onExhausted: "stop" }, { mode: "checkout" }),
    ).toBe("COUPON_KIND");
    expect(
      refusal({ kind: "credit", credits: 5, creditsValidDays: 5, onExhausted: "stop" }, { mode: "redeem" }),
    ).toBeNull();
    expect(refusal({}, { mode: "redeem" })).toBe("COUPON_KIND");
  });
});

describe("effectOf and termsOf", () => {
  it("rounds a percentage half up, never discounts more than the price", () => {
    expect(effectOf({ ...base, percentOffBp: 1250 }, 999)).toMatchObject({ discountMinor: 125, payableMinor: 874 });
    expect(effectOf({ ...base, percentOffBp: null, amountOffMinor: 5000, currency: "cad" }, 3900)).toMatchObject({
      discountMinor: 3900,
      payableMinor: 0,
    });
  });
  it("terms: a percentage carries none of the amount's fields, a repeating one its months", () => {
    expect(termsOf(base)).toEqual({ couponId: "c", termsVersion: 1, percentOffBp: 1000, duration: "once" });
    expect(
      termsOf({
        ...base,
        percentOffBp: null,
        amountOffMinor: 500,
        currency: "cad",
        duration: "repeating",
        durationMonths: 3,
        termsVersion: 2,
      }),
    ).toEqual({
      couponId: "c",
      termsVersion: 2,
      amountOffMinor: 500,
      currency: "cad",
      duration: "repeating",
      durationMonths: 3,
    });
  });
});

describe("the settings", () => {
  it("register every knob with the design's defaults and bounds", () => {
    expect(couponSettings["coupons.enabled"]).toMatchObject({ default: false, kind: "flag" });
    expect(couponSettings["coupons.reservationMinutes"]).toMatchObject({ default: 60, min: 40, max: 1440 });
    expect(couponSettings["coupons.attemptsPerAccountPerHour"]).toMatchObject({ default: 10, min: 1, max: 100 });
    expect(couponSettings["coupons.attemptsPerIpPerHour"]).toMatchObject({ default: 30, min: 1, max: 500 });
    expect(couponSettings["coupons.minCodeLength"]).toMatchObject({ default: 8, min: 4, max: 40 });
    expect(couponSettings["coupons.generatedCodeLength"]).toMatchObject({ default: 10, min: 8, max: 20 });
    expect(couponSettings["coupons.maxPercentOff"]).toMatchObject({ default: 50, min: 1, max: 99 });
    expect(couponSettings["coupons.refundRestoresUse"]).toMatchObject({ default: false, kind: "flag" });
  });
  it("are read with defaults for what the accessor does not know", async () => {
    expect(await readCouponSettings(() => undefined)).toEqual(COUPON_DEFAULTS);
    expect(
      await readCouponSettings(
        (k) =>
          ({ "coupons.enabled": true, "coupons.maxPercentOff": 30, "coupons.refundRestoresUse": true })[
            k as string
          ] as never,
      ),
    ).toMatchObject({ enabled: true, maxPercentOff: 30, refundRestoresUse: true, reservationMinutes: 60 });
  });
  it("give the limiter its action and its hourly limit", () => {
    expect(COUPON_ATTEMPT_ACTION).toBe("couponAttempt");
    expect(couponAttemptLimit(COUPON_DEFAULTS)).toEqual({ perIp: 30, perSubject: 10, windowSeconds: 3600 });
  });
  it("are checked against their bounds", () => {
    expect(checkSettings(COUPON_DEFAULTS)).toBe(COUPON_DEFAULTS);
    for (const bad of [
      { reservationMinutes: 39 },
      { reservationMinutes: 1441 },
      { attemptsPerAccountPerHour: 0 },
      { attemptsPerIpPerHour: 501 },
      { minCodeLength: 3 },
      { generatedCodeLength: 21 },
      { maxPercentOff: 100 },
      { maxPercentOff: 1.5 },
    ]) {
      expect(() => checkSettings({ ...COUPON_DEFAULTS, ...bad })).toThrow(
        expect.objectContaining({ code: "COUPON_BAD_SETTINGS" }),
      );
    }
  });
});
