import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { COUPON_DEFAULTS, type CouponSettings, createCoupons, type CreditsPort, memoryCouponStore, type Query } from "../src";
import { couponsContract, type CouponsHarness, T0 } from "../src/testkit";

/** The module on the in-memory store, with fakes for its neighbours: the same contract the database runs. */
export function memoryHarness(over: { storeFor?: () => ReturnType<typeof memoryCouponStore> } = {}): CouponsHarness {
  const store = over.storeFor?.() ?? memoryCouponStore();
  let now = T0;
  let settings: CouponSettings = { ...COUPON_DEFAULTS, enabled: true };
  const announced: ReturnType<CouponsHarness["announced"]> = [];
  const seen = new Set<string>();
  const audited: ReturnType<CouponsHarness["audited"]> = [];
  const credits: CouponsHarness["credits"] = { granted: [], expired: [] };
  const attempts: CouponsHarness["limiter"]["attempts"] = [];
  let refused: number | null = null;
  const creditsPort: CreditsPort = {
    async grant(_tx, input) {
      credits.granted.push(input);
      return { grantId: randomUUID(), replayed: false };
    },
    async expire(_tx, grantId) {
      credits.expired.push(grantId);
      return { expired: 5 };
    },
  };
  const coupons = createCoupons({
    clock: { now: () => now },
    settings: () => settings,
    storeFor: () => store,
    credits: creditsPort,
    audit: { record: async (_tx, e) => void audited.push({ action: e.action, target: e.target, detail: e.detail }) },
    rateLimit: {
      async check(action, keys) {
        attempts.push({ action, ip: keys.ip, subject: keys.subject });
        return refused === null ? { ok: true } : { ok: false, retryAfterSeconds: refused };
      },
    },
    outbox: {
      async append(_tx, m) {
        const id = m.id ?? randomUUID();
        const appended = !seen.has(id);
        seen.add(id);
        if (appended) announced.push({ type: m.type, id, payload: m.payload as Record<string, unknown> });
        return { id, appended };
      },
    },
  });
  return {
    coupons,
    tx: (async () => []) as unknown as Query,
    setNow: (d) => void (now = d),
    setSettings: (patch) => void (settings = { ...settings, ...patch }),
    newAccount: async () => randomUUID(),
    announced: () => announced,
    audited: () => audited,
    credits,
    limiter: { attempts, refuse: (retry) => void (refused = retry) },
  };
}

couponsContract("memory", async () => memoryHarness());

describe("the module's guards before any store call", () => {
  it("needs the credits ledger for a credit coupon, and the checkout's numbers for a discount", async () => {
    const h = memoryHarness();
    const noCredits = createCoupons({ clock: { now: () => T0 }, settings: { ...COUPON_DEFAULTS, enabled: true }, storeFor: () => memoryCouponStore(), audit: { record: async () => {} }, rateLimit: { check: async () => ({ ok: true }) } });
    await expect(noCredits.redeemCredit(h.tx, { code: "ABCDEFGH", accountId: "a", idempotencyKey: "k" })).rejects.toMatchObject({ code: "COUPON_BAD_SETTINGS" });
    await expect(noCredits.apply(h.tx, { code: "ABCDEFGH", accountId: "a", idempotencyKey: "k" } as never)).rejects.toMatchObject({ code: "COUPON_BAD_INPUT" });
    await expect(noCredits.revoke(h.tx, { id: null, label: "x" }, randomUUID())).rejects.toMatchObject({ code: "COUPON_REDEMPTION_NOT_FOUND" });
  });
  it("refuses settings outside their bounds", async () => {
    const h = memoryHarness();
    h.setSettings({ reservationMinutes: 10 });
    await expect(h.coupons.validate(h.tx, "ABCDEFGH", { mode: "redeem", accountId: "a" })).rejects.toMatchObject({ code: "COUPON_BAD_SETTINGS", status: 500 });
    h.setSettings({ reservationMinutes: 60, maxPercentOff: 100 });
    await expect(h.coupons.admin.generateCode(h.tx)).rejects.toThrow(/maxPercentOff is 1 to 99/);
  });
  it("reads settings from an object or a function, and works without an outbox", async () => {
    const store = memoryCouponStore();
    const coupons = createCoupons({ clock: { now: () => T0 }, settings: { ...COUPON_DEFAULTS, enabled: true }, storeFor: () => store, audit: { record: async () => {} }, rateLimit: { check: async () => ({ ok: true }) } });
    const tx = (async () => []) as unknown as Query;
    const c = await coupons.admin.create(tx, { id: null, label: "a" }, { code: "WELCOME2026", kind: "discount", purpose: "promo", startsAt: new Date(T0.valueOf() - 1000), percentOffBp: 1000, duration: "once" });
    const r = await coupons.apply(tx, { code: c.code, accountId: "a", plan: "pro", amountMinor: 1000, currency: "cad", idempotencyKey: "k" });
    expect(await coupons.redeem(tx, { redemptionId: r.redemptionId, paymentRef: "pi", amountPaidMinor: 900, amountDiscountMinor: 100, currency: "cad" })).toBe("confirmed");
  });
});
