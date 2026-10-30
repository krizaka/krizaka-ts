import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import type { Coupons } from "./coupons";
import {
  type Actor,
  COUPON_DEFAULTS,
  type CouponSettings,
  type CreditsPort,
  type NewCoupon,
  type Query,
} from "./index";

/** What a store (through the module) is run against: the module on that store, a clock the test moves, and fakes for its neighbours. */
export interface CouponsHarness {
  coupons: Coupons;
  /** The query every call goes through (the transaction; a no-op for memory). */
  tx: Query;
  /** Moves the injected clock. */
  setNow(instant: Date): void;
  /** Changes the settings the module reads at each call. */
  setSettings(patch: Partial<CouponSettings>): void;
  /** A fresh account id (a row in the owner table, when the store has one). */
  newAccount(): Promise<string>;
  /** The messages appended to the outbox so far. */
  announced(): { type: string; id: string | undefined; payload: Record<string, unknown> }[];
  /** The audit actions recorded so far, with their target. */
  audited(): {
    action: string;
    target: { type: string; id: string } | null | undefined;
    detail: Record<string, unknown> | undefined;
  }[];
  /** The credits ledger's calls (a fake, or the real one wrapped to record). */
  credits: { granted: Parameters<CreditsPort["grant"]>[1][]; expired: string[] };
  /** The limiter: the attempts counted, and a way to refuse the next ones. */
  limiter: {
    attempts: { action: string; ip: string | null | undefined; subject: string | null | undefined }[];
    refuse(retryAfterSeconds: number | null): void;
  };
}

/** Midday on 26 October 2026 in Toronto: the day the scenarios start on. */
export const T0 = new Date("2026-10-26T16:00:00.000Z");
const HOUR = 3600;
const at = (seconds: number) => new Date(T0.valueOf() + seconds * 1000);
const ADMIN: Actor = { id: null, label: "Eric (admin)" };
const START = at(-HOUR);

/** A discount of 20 % for three months on a monthly plan. */
export const discount = (over: Partial<NewCoupon> = {}): NewCoupon => ({
  code: `PROMO${randomUUID().replace(/-/g, "").slice(0, 8)}`,
  kind: "discount",
  purpose: "promo",
  startsAt: START,
  percentOffBp: 2000,
  duration: "repeating",
  durationMonths: 3,
  ...over,
});

/** 20 free audits, at most 5 a day, valid 30 days. */
export const credit = (over: Partial<NewCoupon> = {}): NewCoupon => ({
  code: `DEMO${randomUUID().replace(/-/g, "").slice(0, 8)}`,
  kind: "credit",
  purpose: "demo",
  startsAt: START,
  credits: 20,
  capPerDay: 5,
  creditsValidDays: 30,
  onExhausted: "stop",
  ...over,
});

async function code(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return "answered";
}

/**
 * What every coupons store must do, behind the same module: the window and the refusals, the counting rule of the uses, reservation,
 * confirmation and release, refunds, credit coupons, partners, the admin. `make` gives an EMPTY module, the clock at {@link T0},
 * `coupons.enabled` on.
 */
export function couponsContract(name: string, make: () => Promise<CouponsHarness>) {
  const ctx = (accountId: string, over: Record<string, unknown> = {}) => ({
    mode: "checkout" as const,
    accountId,
    plan: "pro",
    amountMinor: 10_000,
    currency: "cad",
    ...over,
  });
  const apply = (h: CouponsHarness, codeTyped: string, accountId: string, over: Record<string, unknown> = {}) =>
    h.coupons.apply(h.tx, {
      code: codeTyped,
      accountId,
      plan: "pro",
      amountMinor: 10_000,
      currency: "cad",
      idempotencyKey: randomUUID(),
      ...over,
    });
  const made = async (h: CouponsHarness, over: Partial<NewCoupon> = {}) =>
    h.coupons.admin.create(h.tx, ADMIN, discount({ currency: "cad", ...over }));
  const paid = (redemptionId: string, over: Record<string, unknown> = {}) => ({
    redemptionId,
    paymentRef: `pi_${randomUUID().slice(0, 8)}`,
    amountPaidMinor: 8000,
    amountDiscountMinor: 2000,
    currency: "cad",
    ...over,
  });

  it(`${name}: creates a coupon, reads its code without case, spaces or hyphens, refuses a taken code, and audits`, async () => {
    const h = await make();
    const c = await h.coupons.admin.create(h.tx, ADMIN, discount({ code: "Summer-2026" }));
    expect(c).toMatchObject({ code: "Summer-2026", codeKey: "SUMMER2026", status: "active", termsVersion: 1 });
    expect(await code(h.coupons.admin.create(h.tx, ADMIN, discount({ code: "summer 2026" })))).toBe(
      "COUPON_CODE_TAKEN",
    );
    const a = await h.newAccount();
    for (const typed of [" summer-2026 ", "SUMMER 2026", "summer_2026"])
      expect(await h.coupons.validate(h.tx, typed, ctx(a))).toMatchObject({ ok: true, coupon: { id: c.id } });
    expect(h.audited().map((e) => e.action)).toEqual(["coupon.created"]);
    expect(h.audited()[0]).toMatchObject({ target: { type: "coupon", id: c.id }, detail: { code: "Summer-2026" } });
  });

  it(`${name}: the window opens at its start and closes at its end, to the second`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const c = await made(h, { startsAt: at(HOUR), endsAt: at(2 * HOUR) });
    const state = async (seconds: number) => {
      h.setNow(at(seconds));
      const v = await h.coupons.validate(h.tx, c.code, ctx(a));
      return v.ok ? "ok" : v.code;
    };
    expect(await state(HOUR - 1)).toBe("COUPON_NOT_STARTED");
    expect(await state(HOUR)).toBe("ok");
    expect(await state(2 * HOUR - 1)).toBe("ok");
    expect(await state(2 * HOUR)).toBe("COUPON_EXPIRED");
  });

  it(`${name}: pause, resume and archive; an archived coupon stays archived; each is audited`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const c = await made(h);
    await h.coupons.admin.pause(h.tx, ADMIN, c.id);
    expect(await h.coupons.validate(h.tx, c.code, ctx(a))).toEqual({ ok: false, code: "COUPON_PAUSED" });
    await h.coupons.admin.resume(h.tx, ADMIN, c.id);
    expect((await h.coupons.validate(h.tx, c.code, ctx(a))).ok).toBe(true);
    await h.coupons.admin.archive(h.tx, ADMIN, c.id);
    expect(await h.coupons.validate(h.tx, c.code, ctx(a))).toEqual({ ok: false, code: "COUPON_PAUSED" });
    expect(await code(h.coupons.admin.resume(h.tx, ADMIN, c.id))).toBe("COUPON_BAD_INPUT");
    expect(h.audited().map((e) => e.action)).toEqual([
      "coupon.created",
      "coupon.paused",
      "coupon.resumed",
      "coupon.archived",
    ]);
  });

  it(`${name}: refuses with a typed code: unknown, kind, plan, minimum, currency, new customers, provider, too large, disabled`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const refusal = async (typed: string, over: Record<string, unknown> = {}) => {
      const v = await h.coupons.validate(h.tx, typed, ctx(a, over));
      return v.ok ? "ok" : v.code;
    };
    const plan = await made(h, { plans: ["pro"], minimumMinor: 5000 });
    const fresh = await made(h, { newCustomersOnly: true });
    h.setSettings({ maxPercentOff: 70 }); // a coupon is created within the bound, then the admin lowers it
    const big = await made(h, { percentOffBp: 6000 });
    h.setSettings({ maxPercentOff: 50 });
    const fixed = await made(h, {
      percentOffBp: null,
      amountOffMinor: 6000,
      currency: "cad",
      duration: "once",
      durationMonths: null,
    });
    const cr = await h.coupons.admin.create(h.tx, ADMIN, credit());
    expect(await refusal("NOPE")).toBe("COUPON_UNKNOWN");
    expect(await refusal("???")).toBe("COUPON_UNKNOWN");
    expect(await refusal(plan.code, { plan: "audit" })).toBe("COUPON_NOT_FOR_PLAN");
    expect(await refusal(plan.code, { amountMinor: 4999 })).toBe("COUPON_MINIMUM");
    expect(await refusal(plan.code, { currency: "usd" })).toBe("COUPON_CURRENCY");
    expect(await refusal(plan.code)).toBe("ok");
    expect(await refusal(fresh.code, { hasPaidBefore: true })).toBe("COUPON_NEW_CUSTOMERS_ONLY");
    expect(await refusal(fresh.code, { hasPaidBefore: false })).toBe("ok");
    expect(await refusal(plan.code, { providerSupportsDiscounts: false })).toBe("COUPON_PROVIDER");
    expect(await refusal(big.code)).toBe("COUPON_TOO_LARGE");
    expect(await refusal(fixed.code)).toBe("COUPON_TOO_LARGE");
    expect(await refusal(fixed.code, { amountMinor: 12_000 })).toBe("ok");
    expect(await refusal(cr.code)).toBe("COUPON_KIND");
    h.setSettings({ maxPercentOff: 70 });
    expect(await refusal(big.code)).toBe("ok");
    h.setSettings({ enabled: false });
    expect(await refusal(plan.code)).toBe("COUPON_DISABLED");
  });

  it(`${name}: counts an attempt before any lookup, and refuses past the limit with the time to wait`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const c = await made(h);
    await h.coupons.validate(h.tx, c.code, ctx(a, { ip: "203.0.113.9" }));
    await h.coupons.validate(h.tx, "WHATEVER", ctx(a));
    expect(h.limiter.attempts).toEqual([
      { action: "couponAttempt", ip: "203.0.113.9", subject: a },
      { action: "couponAttempt", ip: undefined, subject: a },
    ]);
    h.limiter.refuse(42);
    expect(await h.coupons.validate(h.tx, c.code, ctx(a))).toEqual({
      ok: false,
      code: "COUPON_RATE_LIMITED",
      retryAfterSeconds: 42,
    });
    await expect(apply(h, c.code, a)).rejects.toMatchObject({
      code: "COUPON_RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 42,
    });
    h.limiter.refuse(null);
    expect((await h.coupons.validate(h.tx, c.code, ctx(a))).ok).toBe(true);
  });

  it(`${name}: says what a discount gives in numbers (the provider computes the real amount and its taxes)`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const pct = await made(h);
    const fixed = await made(h, {
      percentOffBp: null,
      amountOffMinor: 500,
      currency: "cad",
      duration: "once",
      durationMonths: null,
    });
    expect(await h.coupons.validate(h.tx, pct.code, ctx(a))).toMatchObject({
      ok: true,
      effect: {
        kind: "discount",
        percentOffBp: 2000,
        duration: "repeating",
        durationMonths: 3,
        discountMinor: 2000,
        payableMinor: 8000,
      },
    });
    expect(await h.coupons.validate(h.tx, fixed.code, ctx(a, { amountMinor: 3900 }))).toMatchObject({
      effect: { discountMinor: 500, payableMinor: 3400, amountOffMinor: 500 },
    });
  });

  it(`${name}: reserves a use under the counting rule: reserved uses count until their deadline, released ones never`, async () => {
    const h = await make();
    const [a1, a2, a3] = [await h.newAccount(), await h.newAccount(), await h.newAccount()];
    const c = await made(h, { maxRedemptions: 2 });
    const r1 = await apply(h, c.code, a1);
    expect(await code(apply(h, c.code, a1))).toBe("COUPON_ACCOUNT_LIMIT");
    await apply(h, c.code, a2);
    expect(await code(apply(h, c.code, a3))).toBe("COUPON_EXHAUSTED");
    expect(await h.coupons.validate(h.tx, c.code, ctx(a3))).toEqual({ ok: false, code: "COUPON_EXHAUSTED" });
    expect(await h.coupons.release(h.tx, { redemptionId: r1.redemptionId })).toBe(true);
    expect((await apply(h, c.code, a3)).replayed).toBe(false);
    h.setNow(at(61 * 60)); // the two reservations still held lapse after 60 minutes
    expect((await h.coupons.validate(h.tx, c.code, ctx(a1))).ok).toBe(true);
  });

  it(`${name}: apply is idempotent by key, and a key is not shared between coupons or accounts`, async () => {
    const h = await make();
    const [a1, a2] = [await h.newAccount(), await h.newAccount()];
    const c = await made(h);
    const other = await made(h);
    const first = await apply(h, c.code, a1, { idempotencyKey: "co-1" });
    const again = await apply(h, c.code, a1, { idempotencyKey: "co-1" });
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ redemptionId: first.redemptionId, replayed: true });
    expect(await code(apply(h, c.code, a2, { idempotencyKey: "co-1" }))).toBe("COUPON_KEY_REUSED");
    expect(await code(apply(h, other.code, a1, { idempotencyKey: "co-1" }))).toBe("COUPON_KEY_REUSED");
    expect(first.discount).toEqual({
      couponId: c.id,
      termsVersion: 1,
      percentOffBp: 2000,
      duration: "repeating",
      durationMonths: 3,
    });
    expect(first.effect).toMatchObject({ discountMinor: 2000, payableMinor: 8000 });
    expect(first.reservedUntil).toEqual(at(HOUR));
  });

  it(`${name}: hands the provider terms for an amount-off coupon with its currency`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const c = await made(h, {
      percentOffBp: null,
      amountOffMinor: 500,
      currency: "cad",
      duration: "once",
      durationMonths: null,
    });
    expect((await apply(h, c.code, a)).discount).toEqual({
      couponId: c.id,
      termsVersion: 1,
      amountOffMinor: 500,
      currency: "cad",
      duration: "once",
    });
  });

  it(`${name}: confirms a use once, from the checkout's metadata or from the session when the attach never ran`, async () => {
    const h = await make();
    const [a1, a2, a3] = [await h.newAccount(), await h.newAccount(), await h.newAccount()];
    const c = await made(h, { maxRedemptions: 5 });
    const r1 = await apply(h, c.code, a1);
    const p1 = paid(r1.redemptionId, { paymentRef: "pi_1" });
    expect(await h.coupons.redeem(h.tx, p1)).toBe("confirmed");
    expect(await h.coupons.redeem(h.tx, p1)).toBe("already");
    const r2 = await apply(h, c.code, a2);
    await h.coupons.attachCheckout(h.tx, r2.redemptionId, "cs_2", at(2 * HOUR));
    expect(
      await h.coupons.redeem(h.tx, {
        checkoutRef: "cs_2",
        paymentRef: "pi_2",
        amountPaidMinor: 8000,
        amountDiscountMinor: 2000,
        currency: "cad",
      }),
    ).toBe("confirmed");
    const r3 = await apply(h, c.code, a3);
    expect(await h.coupons.redeem(h.tx, paid(r3.redemptionId, { paymentRef: "pi_1" }))).toBe("already");
    expect(
      await h.coupons.redeem(h.tx, {
        redemptionId: randomUUID(),
        checkoutRef: "cs_none",
        paymentRef: "pi_x",
        amountPaidMinor: 1,
        amountDiscountMinor: 0,
        currency: "cad",
      }),
    ).toBe("unknown");
    const [row] = (await h.coupons.admin.redemptions(h.tx, { couponId: c.id, status: "confirmed" })).filter(
      (r) => r.id === r1.redemptionId,
    );
    expect(row).toMatchObject({
      status: "confirmed",
      paymentRef: "pi_1",
      amountPaidMinor: 8000,
      amountDiscountMinor: 2000,
      overLimit: false,
      accountId: a1,
    });
  });

  it(`${name}: attaching the session makes the reservation outlive it`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const c = await made(h);
    const r = await apply(h, c.code, a);
    await h.coupons.attachCheckout(h.tx, r.redemptionId, "cs_9", at(3 * HOUR));
    h.setNow(at(3 * HOUR + 4 * 60));
    expect(await h.coupons.release(h.tx, { checkoutRef: "cs_9" })).toBe(true);
    expect(await code(h.coupons.attachCheckout(h.tx, randomUUID(), "cs_x"))).toBe("COUPON_REDEMPTION_NOT_FOUND");
  });

  it(`${name}: a payment after the release is honoured and flagged: released becomes confirmed with over_limit`, async () => {
    const h = await make();
    const [a1, a2] = [await h.newAccount(), await h.newAccount()];
    const c = await made(h, { maxRedemptions: 1 });
    const r1 = await apply(h, c.code, a1);
    await h.coupons.release(h.tx, { redemptionId: r1.redemptionId });
    const r2 = await apply(h, c.code, a2);
    await h.coupons.redeem(h.tx, paid(r2.redemptionId));
    expect(await h.coupons.redeem(h.tx, paid(r1.redemptionId))).toBe("confirmed");
    const late = (await h.coupons.admin.redemptions(h.tx, { couponId: c.id })).find((r) => r.id === r1.redemptionId);
    expect(late).toMatchObject({ status: "confirmed", overLimit: true });
    expect(await h.coupons.validate(h.tx, c.code, ctx(await h.newAccount()))).toEqual({
      ok: false,
      code: "COUPON_EXHAUSTED",
    });
  });

  it(`${name}: the sweeper releases reservations past their deadline, and a released one is not released twice`, async () => {
    const h = await make();
    const [a1, a2] = [await h.newAccount(), await h.newAccount()];
    const c = await made(h);
    const r1 = await apply(h, c.code, a1);
    await apply(h, c.code, a2);
    expect(await h.coupons.releaseExpired(h.tx)).toBe(0);
    h.setNow(at(HOUR));
    expect(await h.coupons.releaseExpired(h.tx)).toBe(2);
    expect(await h.coupons.releaseExpired(h.tx)).toBe(0);
    expect(await h.coupons.release(h.tx, { redemptionId: r1.redemptionId })).toBe(false);
    expect(await h.coupons.release(h.tx, { redemptionId: randomUUID() })).toBe(false);
    expect(h.announced().filter((m) => m.type === "evt.coupon.released.v1")).toHaveLength(2);
  });

  it(`${name}: a refund adds up and never changes the status; a partial one keeps the use, a full one gives it back only if the setting says so`, async () => {
    const h = await make();
    const [a1, a2] = [await h.newAccount(), await h.newAccount()];
    const c = await made(h, { maxRedemptions: 1 });
    const r1 = await apply(h, c.code, a1);
    await h.coupons.redeem(h.tx, paid(r1.redemptionId, { paymentRef: "pi_a", amountPaidMinor: 8000 }));
    expect(await h.coupons.refund(h.tx, { paymentRef: "pi_a", amountRefunded: 2000 })).toBe("refunded");
    expect(await h.coupons.refund(h.tx, { paymentRef: "pi_a", amountRefunded: 2000 })).toBe("already");
    expect(await h.coupons.refund(h.tx, { paymentRef: "pi_a", amountRefunded: 1000 })).toBe("already");
    expect(await h.coupons.refund(h.tx, { paymentRef: "pi_zz", amountRefunded: 1 })).toBe("unknown");
    expect(await h.coupons.refund(h.tx, { paymentRef: null, invoiceRef: null, amountRefunded: 1 })).toBe("unknown");
    expect(await h.coupons.refund(h.tx, { paymentRef: "pi_a", amountRefunded: 8000 })).toBe("refunded");
    const row = (await h.coupons.admin.redemptions(h.tx, { couponId: c.id }))[0]!;
    expect(row).toMatchObject({ status: "confirmed", amountRefundedMinor: 8000, useRestored: false });
    expect(await code(apply(h, c.code, a2))).toBe("COUPON_EXHAUSTED");

    const b = await made(h, { maxRedemptions: 1 });
    h.setSettings({ refundRestoresUse: true });
    const rb = await apply(h, b.code, a1);
    await h.coupons.redeem(h.tx, paid(rb.redemptionId, { paymentRef: "pi_b", amountPaidMinor: 8000 }));
    await h.coupons.refund(h.tx, { paymentRef: "pi_b", amountRefunded: 7999 });
    expect(await code(apply(h, b.code, a2))).toBe("COUPON_EXHAUSTED");
    await h.coupons.refund(h.tx, { invoiceRef: "pi_b", amountRefunded: 8000 });
    expect((await apply(h, b.code, a2)).replayed).toBe(false);
    expect(
      h
        .announced()
        .filter((m) => m.type === "evt.coupon.refunded.v1")
        .map((m) => m.payload.useRestored),
    ).toEqual([false, false, false, true]);
  });

  it(`${name}: the terms are locked after the first use; the rules stay editable; a change is audited with before and after`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const c = await made(h);
    const before = await h.coupons.admin.update(h.tx, ADMIN, c.id, { percentOffBp: 1500 });
    expect(before.percentOffBp).toBe(1500);
    await apply(h, c.code, a);
    expect(await code(h.coupons.admin.update(h.tx, ADMIN, c.id, { percentOffBp: 3000 }))).toBe("COUPON_TERMS_LOCKED");
    const after = await h.coupons.admin.update(h.tx, ADMIN, c.id, { maxRedemptions: 10, endsAt: at(5 * HOUR) });
    expect(after).toMatchObject({ maxRedemptions: 10, percentOffBp: 1500 });
    expect(await h.coupons.admin.update(h.tx, ADMIN, c.id, { maxRedemptions: 10 })).toMatchObject({
      maxRedemptions: 10,
    });
    expect(await code(h.coupons.admin.update(h.tx, ADMIN, c.id, { endsAt: START }))).toBe("COUPON_BAD_INPUT");
    const entry = h
      .audited()
      .filter((e) => e.action === "coupon.updated")
      .at(-1)!;
    expect(entry.detail).toMatchObject({
      changed: ["maxRedemptions", "endsAt"],
      before: { maxRedemptions: null, endsAt: null },
      after: { maxRedemptions: 10 },
    });
    expect(await code(h.coupons.admin.update(h.tx, ADMIN, randomUUID(), { maxRedemptions: 1 }))).toBe(
      "COUPON_NOT_FOUND",
    );
  });

  it(`${name}: the admin cannot create what the rules refuse: a free discount, a fixed amount forever, a credit coupon without a cap of its own`, async () => {
    const h = await make();
    const bad = (over: Partial<NewCoupon>) =>
      code(h.coupons.admin.create(h.tx, ADMIN, discount({ currency: "cad", ...over })));
    expect(await bad({ percentOffBp: 10_000 })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ percentOffBp: 5001 })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ percentOffBp: null, amountOffMinor: 500, duration: "forever", durationMonths: null })).toBe(
      "COUPON_BAD_INPUT",
    );
    expect(await bad({ percentOffBp: null, amountOffMinor: null })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ amountOffMinor: 5 })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ duration: "once" })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ code: "ABC" })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ code: "bad!code123" })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ endsAt: START })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ credits: 5 })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ purpose: "partner" })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ partnerId: randomUUID() })).toBe("COUPON_BAD_INPUT");
    expect(await bad({ purpose: "partner", partnerId: randomUUID() })).toBe("COUPON_PARTNER_NOT_FOUND");
    const credits = (over: Partial<NewCoupon>) => code(h.coupons.admin.create(h.tx, ADMIN, credit(over)));
    expect(await credits({ credits: null })).toBe("COUPON_BAD_INPUT");
    expect(await credits({ creditsValidDays: null })).toBe("COUPON_BAD_INPUT");
    expect(await credits({ onExhausted: null })).toBe("COUPON_BAD_INPUT");
    expect(await credits({ percentOffBp: 1000 })).toBe("COUPON_BAD_INPUT");
    expect(await credits({ capPerDay: 0 })).toBe("COUPON_BAD_INPUT");
    expect(await credits({})).toBe("answered");
  });

  it(`${name}: a credit coupon grants capped credits that expire, once per key, and the use counts`, async () => {
    const h = await make();
    const [a, b] = [await h.newAccount(), await h.newAccount()];
    const c = await h.coupons.admin.create(
      h.tx,
      ADMIN,
      credit({ capPerMonth: 12, maxRedemptions: 1, onExhausted: "fallback_paid" }),
    );
    expect(await h.coupons.validate(h.tx, c.code, { mode: "redeem", accountId: a })).toMatchObject({
      ok: true,
      effect: {
        kind: "credit",
        credits: 20,
        capPerDay: 5,
        capPerMonth: 12,
        validDays: 30,
        onExhausted: "fallback_paid",
      },
    });
    const got = await h.coupons.redeemCredit(h.tx, { code: c.code, accountId: a, idempotencyKey: "rc-1" });
    expect(got).toMatchObject({ credits: 20, replayed: false });
    expect(got.expiresAt).toEqual(at(30 * 24 * HOUR));
    expect(h.credits.granted).toEqual([
      {
        accountId: a,
        amount: 20,
        capPerDay: 5,
        capPerMonth: 12,
        expiresAt: at(30 * 24 * HOUR),
        onExhausted: "fallback_paid",
        source: `coupon:${got.redemptionId}`,
        idempotencyKey: `coupon-${got.redemptionId}`,
      },
    ]);
    expect((await h.coupons.redeemCredit(h.tx, { code: c.code, accountId: a, idempotencyKey: "rc-1" })).replayed).toBe(
      true,
    );
    expect(h.credits.granted).toHaveLength(1);
    expect(await code(h.coupons.redeemCredit(h.tx, { code: c.code, accountId: b, idempotencyKey: "rc-1" }))).toBe(
      "COUPON_KEY_REUSED",
    );
    expect(await code(h.coupons.redeemCredit(h.tx, { code: c.code, accountId: b, idempotencyKey: "rc-2" }))).toBe(
      "COUPON_EXHAUSTED",
    );
    const kind = await made(h);
    expect(await code(h.coupons.redeemCredit(h.tx, { code: kind.code, accountId: b, idempotencyKey: "rc-3" }))).toBe(
      "COUPON_KIND",
    );
    expect(await code(apply(h, c.code, b))).toBe("COUPON_KIND");
  });

  it(`${name}: revoking a credit redemption writes off what is left, keeps the use counted, and refuses what is not a credit`, async () => {
    const h = await make();
    const [a, b] = [await h.newAccount(), await h.newAccount()];
    const c = await h.coupons.admin.create(h.tx, ADMIN, credit({ maxRedemptions: 1 }));
    const got = await h.coupons.redeemCredit(h.tx, { code: c.code, accountId: a, idempotencyKey: "rc-1" });
    await h.coupons.revoke(h.tx, ADMIN, got.redemptionId);
    await h.coupons.revoke(h.tx, ADMIN, got.redemptionId);
    expect(h.credits.expired).toEqual([got.grantId]);
    expect(await code(h.coupons.redeemCredit(h.tx, { code: c.code, accountId: b, idempotencyKey: "rc-2" }))).toBe(
      "COUPON_EXHAUSTED",
    );
    const d = await made(h);
    const r = await apply(h, d.code, a);
    expect(await code(h.coupons.revoke(h.tx, ADMIN, r.redemptionId))).toBe("COUPON_NOT_REVOCABLE");
    expect(await code(h.coupons.revoke(h.tx, ADMIN, randomUUID()))).toBe("COUPON_REDEMPTION_NOT_FOUND");
    expect(h.audited().filter((e) => e.action === "coupon.revoked")).toHaveLength(1);
  });

  it(`${name}: announces the redemption with the partner and the amounts, and the last allowed use, once each`, async () => {
    const h = await make();
    const [a1, a2] = [await h.newAccount(), await h.newAccount()];
    const partner = await h.coupons.admin.partners.create(h.tx, ADMIN, {
      displayName: "Marie Tremblay",
      contactEmail: "Marie@Example.com",
    });
    const c = await made(h, { purpose: "partner", partnerId: partner.id, maxRedemptions: 2 });
    for (const [i, a] of [a1, a2].entries()) {
      const r = await apply(h, c.code, a);
      await h.coupons.redeem(h.tx, paid(r.redemptionId, { paymentRef: `pi_${i}` }));
    }
    const redeemed = h.announced().filter((m) => m.type === "evt.coupon.redeemed.v1");
    expect(redeemed).toHaveLength(2);
    expect(redeemed[0]!.payload).toMatchObject({
      couponId: c.id,
      kind: "discount",
      purpose: "partner",
      partnerId: partner.id,
      amountPaidMinor: 8000,
      amountDiscountMinor: 2000,
      currency: "cad",
      credits: null,
      overLimit: false,
    });
    expect(h.announced().filter((m) => m.type === "evt.coupon.exhausted.v1")).toHaveLength(1);
  });

  it(`${name}: partners: the view is net of refunds and never names a customer; erasing keeps the numbers and blanks the person`, async () => {
    const h = await make();
    const [a1, a2] = [await h.newAccount(), await h.newAccount()];
    const partner = await h.coupons.admin.partners.create(h.tx, ADMIN, {
      displayName: "Marie Tremblay",
      contactEmail: "marie@example.com",
    });
    const other = await h.coupons.admin.partners.create(h.tx, ADMIN, { displayName: "Paul" });
    const c = await made(h, { purpose: "partner", partnerId: partner.id });
    const d = await h.coupons.admin.create(h.tx, ADMIN, credit({ purpose: "partner", partnerId: partner.id }));
    const r1 = await apply(h, c.code, a1);
    await h.coupons.redeem(
      h.tx,
      paid(r1.redemptionId, { paymentRef: "pi_p1", amountPaidMinor: 10_000, amountDiscountMinor: 2000 }),
    );
    await h.coupons.refund(h.tx, { paymentRef: "pi_p1", amountRefunded: 1000 });
    await h.coupons.redeemCredit(h.tx, { code: d.code, accountId: a2, idempotencyKey: "rc-p" });
    const report = await h.coupons.admin.partners.report(h.tx, ADMIN, partner.id);
    expect(report).toEqual(
      expect.arrayContaining([
        {
          couponId: c.id,
          code: c.code,
          currency: "cad",
          redemptions: 1,
          discountMinor: 2000,
          revenueMinor: 9000,
          creditsGranted: 0,
        },
        {
          couponId: d.id,
          code: d.code,
          currency: null,
          redemptions: 1,
          discountMinor: 0,
          revenueMinor: 0,
          creditsGranted: 20,
        },
      ]),
    );
    expect(JSON.stringify(report)).not.toContain(a1);
    expect(await h.coupons.admin.partners.report(h.tx, ADMIN, other.id)).toEqual([]);
    expect(
      await h.coupons.admin.partners.report(h.tx, ADMIN, partner.id, { from: at(HOUR), to: at(2 * HOUR) }),
    ).toEqual([]);
    expect(h.audited().filter((e) => e.action === "partner.report_read")).toHaveLength(3);
    expect(await code(h.coupons.admin.partners.report(h.tx, ADMIN, randomUUID()))).toBe("COUPON_PARTNER_NOT_FOUND");

    const exported = await h.coupons.admin.partners.export(h.tx, partner.id);
    expect(exported.partner).toMatchObject({ displayName: "Marie Tremblay", contactEmail: "marie@example.com" });
    const erased = await h.coupons.admin.partners.erase(h.tx, ADMIN, partner.id);
    expect(erased).toMatchObject({ displayName: null, contactEmail: null, status: "archived" });
    expect(erased.erasedAt).not.toBeNull();
    expect((await h.coupons.admin.partners.erase(h.tx, ADMIN, partner.id)).erasedAt).toEqual(erased.erasedAt);
    expect((await h.coupons.admin.partners.export(h.tx, partner.id)).rows).toHaveLength(2);
    expect((await h.coupons.admin.partners.list(h.tx)).map((p) => p.id)).toEqual([other.id]);
    expect((await h.coupons.admin.partners.list(h.tx, { includeArchived: true })).map((p) => p.id)).toEqual(
      expect.arrayContaining([partner.id, other.id]),
    );
  });

  it(`${name}: partners: a name and a well-formed e-mail, archive and restore`, async () => {
    const h = await make();
    expect(await code(h.coupons.admin.partners.create(h.tx, ADMIN, { displayName: "" }))).toBe("COUPON_BAD_INPUT");
    expect(await code(h.coupons.admin.partners.create(h.tx, ADMIN, { displayName: "x".repeat(81) }))).toBe(
      "COUPON_BAD_INPUT",
    );
    expect(
      await code(h.coupons.admin.partners.create(h.tx, ADMIN, { displayName: "Marie", contactEmail: "nope" })),
    ).toBe("COUPON_BAD_INPUT");
    const p = await h.coupons.admin.partners.create(h.tx, ADMIN, { displayName: " Marie " });
    expect(p).toMatchObject({ displayName: "Marie", contactEmail: null, status: "active" });
    expect((await h.coupons.admin.partners.archive(h.tx, ADMIN, p.id)).status).toBe("archived");
    expect((await h.coupons.admin.partners.restore(h.tx, ADMIN, p.id)).status).toBe("active");
    expect(await code(h.coupons.admin.partners.archive(h.tx, ADMIN, randomUUID()))).toBe("COUPON_PARTNER_NOT_FOUND");
    expect(await h.coupons.admin.partners.get(h.tx, randomUUID())).toBeNull();
  });

  it(`${name}: a price drop pauses the fixed-amount coupons that would now be too large, and only those`, async () => {
    const h = await make();
    const small = await made(h, {
      percentOffBp: null,
      amountOffMinor: 1000,
      currency: "cad",
      duration: "once",
      durationMonths: null,
      plans: ["pro"],
    });
    const other = await made(h, {
      percentOffBp: null,
      amountOffMinor: 1000,
      currency: "cad",
      duration: "once",
      durationMonths: null,
      plans: ["audit"],
    });
    const percent = await made(h);
    expect(await h.coupons.admin.checkPrices(h.tx, [{ plan: "pro", amountMinor: 2000, currency: "cad" }])).toEqual([]);
    expect(
      await h.coupons.admin.checkPrices(h.tx, [
        { plan: "pro", amountMinor: 1999, currency: "cad" },
        { plan: "pro", amountMinor: 100, currency: "usd" },
      ]),
    ).toEqual([small.id]);
    expect((await h.coupons.admin.get(h.tx, small.id))?.status).toBe("paused");
    expect((await h.coupons.admin.get(h.tx, other.id))?.status).toBe("active");
    expect((await h.coupons.admin.get(h.tx, percent.id))?.status).toBe("active");
    expect(h.audited().filter((e) => e.action === "coupon.paused_by_price")).toHaveLength(1);
  });

  it(`${name}: lists coupons and redemptions with filters and pages`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const d = await made(h);
    const c = await h.coupons.admin.create(h.tx, ADMIN, credit());
    await h.coupons.admin.pause(h.tx, ADMIN, d.id);
    expect((await h.coupons.admin.list(h.tx)).map((x) => x.id)).toEqual(expect.arrayContaining([d.id, c.id]));
    expect((await h.coupons.admin.list(h.tx, { kind: "credit" })).map((x) => x.id)).toEqual([c.id]);
    expect((await h.coupons.admin.list(h.tx, { status: "paused" })).map((x) => x.id)).toEqual([d.id]);
    expect((await h.coupons.admin.list(h.tx, { purpose: "demo" })).map((x) => x.id)).toEqual([c.id]);
    expect(await h.coupons.admin.list(h.tx, { limit: 1, offset: 5 })).toEqual([]);
    expect(await h.coupons.admin.get(h.tx, randomUUID())).toBeNull();
    await h.coupons.redeemCredit(h.tx, { code: c.code, accountId: a, idempotencyKey: "rc-l" });
    expect(await h.coupons.admin.redemptions(h.tx, { couponId: c.id })).toHaveLength(1);
    expect(await h.coupons.admin.redemptions(h.tx, { status: "released" })).toEqual([]);
    expect(await h.coupons.admin.redemptions(h.tx, { from: at(HOUR) })).toEqual([]);
    expect(await h.coupons.admin.redemptions(h.tx, { to: at(-5 * HOUR) })).toEqual([]);
  });

  it(`${name}: generates a free code of the configured length from an alphabet without I, L, O and U`, async () => {
    const h = await make();
    h.setSettings({ generatedCodeLength: 12 });
    const generated = await h.coupons.admin.generateCode(h.tx);
    expect(generated).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const c = await h.coupons.admin.create(h.tx, ADMIN, discount({ code: generated }));
    expect(c.codeKey).toBe(generated);
  });
}

export { COUPON_DEFAULTS };
