import { addHours, addMinutes } from "@krizaka/time";

import { COUPON_EVENT } from "./events";
import { type Kernel, SYSTEM } from "./kernel";
import {
  type Actor,
  type Coupon,
  COUPON_CODE,
  COUPON_ERROR,
  CouponError,
  type CouponRefusal,
  type DiscountTerms,
  KIND,
  type Query,
  type Redemption,
  REDEMPTION_STATUS,
} from "./port";
import {
  type CheckoutContext,
  countsAsUse,
  COUPON_ATTEMPT_ACTION,
  type CreditEffect,
  type DiscountEffect,
  effectOf,
  normalizeCode,
  refusalOf,
  termsOf,
} from "./rules";

/** The coupon as a checkout shows it. Never the limits or the partner. */
export interface CouponView {
  id: string;
  code: string;
  kind: Coupon["kind"];
  purpose: Coupon["purpose"];
  endsAt: Date | null;
}

export type Validation =
  | { ok: true; coupon: CouponView; effect: DiscountEffect | CreditEffect }
  | { ok: false; code: CouponRefusal; retryAfterSeconds?: number };

export interface ApplyInput extends Omit<CheckoutContext, "mode"> {
  code: string;
  /** One key per checkout attempt: a replay returns the same reservation. */
  idempotencyKey: string;
}

export interface Applied {
  redemptionId: string;
  /** The immutable terms for the payments port's `checkout({ discount })`. */
  discount: DiscountTerms;
  effect: DiscountEffect;
  reservedUntil: Date;
  replayed: boolean;
}

export interface RedeemInput {
  /** From the checkout's metadata (`redemption_id`); found first. */
  redemptionId?: string | null;
  /** The checkout session's reference; found when the metadata is missing. */
  checkoutRef?: string | null;
  /** The payment (a payment intent), or the invoice for a subscription; null for a free checkout. */
  paymentRef: string | null;
  amountPaidMinor: number | null;
  amountDiscountMinor: number;
  currency: string | null;
}

export interface CreditRedemption {
  redemptionId: string;
  grantId: string;
  credits: number;
  expiresAt: Date;
  replayed: boolean;
}

const view = (c: Coupon): CouponView => ({
  id: c.id,
  code: c.code,
  kind: c.kind,
  purpose: c.purpose,
  endsAt: c.endsAt,
});
const REFUSALS: readonly string[] = Object.values(COUPON_CODE);
const isRefusal = (code: string): code is CouponRefusal => REFUSALS.includes(code);
const refuse = (code: CouponRefusal, retryAfterSeconds?: number) => new CouponError(code, code, retryAfterSeconds);
// @fixed: a session's reservation outlives its session by five minutes, so a payment at the very end is still found (ADR-002 §4.1)
const ATTACH_GRACE_MINUTES = 5;
// @fixed: the sweeper's batch
const SWEEP_BATCH = 500;

/** The flows of a coupon's life at checkout and at redemption (ADR-002 §4). */
export function makeFlows(k: Kernel) {
  /** Counts one attempt with a code; refuses past the limit, before any lookup. */
  async function attempt(ctx: Pick<CheckoutContext, "accountId" | "ip">): Promise<void> {
    const r = await k.deps.rateLimit.check(COUPON_ATTEMPT_ACTION, { ip: ctx.ip, subject: ctx.accountId });
    if (!r.ok) throw refuse(COUPON_CODE.rateLimited, r.retryAfterSeconds);
  }

  /** The coupon behind a typed code, or the refusal. */
  async function lookup(tx: Query, code: string, forUpdate: boolean): Promise<Coupon> {
    const key = normalizeCode(code);
    const coupon = key ? await k.store(tx).couponByKey(key, forUpdate) : null;
    if (!coupon) throw refuse(COUPON_CODE.unknown);
    return coupon;
  }

  async function check(tx: Query, coupon: Coupon, ctx: CheckoutContext): Promise<void> {
    const settings = await k.settings();
    const now = k.now();
    const usage = await k.store(tx).usage(coupon.id, ctx.accountId, now);
    const refusal = refusalOf(coupon, ctx, usage, now, settings);
    if (refusal) throw refuse(refusal);
  }

  const mustBeEnabled = async () => {
    if (!(await k.settings()).enabled) throw refuse(COUPON_CODE.disabled);
  };

  const needsAmount = (ctx: CheckoutContext) => {
    if (
      ctx.mode === "checkout" &&
      (ctx.plan === undefined || ctx.amountMinor === undefined || ctx.currency === undefined)
    ) {
      throw new CouponError(COUPON_ERROR.badInput, "A checkout names its plan, amount and currency");
    }
  };

  async function validate(query: Query, code: string, ctx: CheckoutContext): Promise<Validation> {
    try {
      await mustBeEnabled();
      needsAmount(ctx);
      await attempt(ctx);
      const coupon = await lookup(query, code, false);
      await check(query, coupon, ctx);
      return { ok: true, coupon: view(coupon), effect: effectOf(coupon, ctx.amountMinor ?? 0) };
    } catch (error) {
      if (error instanceof CouponError && isRefusal(error.code))
        return {
          ok: false,
          code: error.code,
          ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
        };
      throw error;
    }
  }

  async function apply(tx: Query, input: ApplyInput): Promise<Applied> {
    const ctx: CheckoutContext = { ...input, mode: "checkout" };
    await mustBeEnabled();
    needsAmount(ctx);
    await attempt(ctx);
    const coupon = await lookup(tx, input.code, true);
    const store = k.store(tx);
    const known = await store.redemptionByKey(input.idempotencyKey);
    if (known) {
      if (known.couponId !== coupon.id || known.accountId !== input.accountId)
        throw new CouponError(COUPON_ERROR.keyReused, "This idempotency key was used for another coupon or account");
      return {
        redemptionId: known.id,
        discount: termsOf(coupon),
        effect: effectOf(coupon, input.amountMinor!) as DiscountEffect,
        reservedUntil: known.reservedUntil ?? known.createdAt,
        replayed: true,
      };
    }
    await check(tx, coupon, ctx);
    const now = k.now();
    const reservedUntil = addMinutes(now, (await k.settings()).reservationMinutes);
    const redemption: Redemption = {
      id: k.newId(),
      couponId: coupon.id,
      accountId: input.accountId,
      partnerId: coupon.partnerId,
      status: REDEMPTION_STATUS.reserved,
      idempotencyKey: input.idempotencyKey,
      reservedUntil,
      checkoutRef: null,
      paymentRef: null,
      amountPaidMinor: null,
      amountDiscountMinor: null,
      amountRefundedMinor: 0,
      useRestored: false,
      currency: input.currency ?? null,
      creditGrantId: null,
      overLimit: false,
      createdAt: now,
      confirmedAt: null,
      endedAt: null,
    };
    await store.insertRedemption(redemption);
    return {
      redemptionId: redemption.id,
      discount: termsOf(coupon),
      effect: effectOf(coupon, input.amountMinor!) as DiscountEffect,
      reservedUntil,
      replayed: false,
    };
  }

  async function attachCheckout(
    tx: Query,
    redemptionId: string,
    checkoutRef: string,
    sessionExpiresAt?: Date | null,
  ): Promise<void> {
    const store = k.store(tx);
    const r = await store.redemptionById(redemptionId);
    if (!r) throw new CouponError(COUPON_ERROR.redemptionNotFound, `No redemption ${redemptionId}`);
    await store.updateRedemption(redemptionId, null, { checkoutRef });
    if (r.status !== REDEMPTION_STATUS.reserved || !sessionExpiresAt) return;
    const wanted = addMinutes(sessionExpiresAt, ATTACH_GRACE_MINUTES);
    if (!r.reservedUntil || wanted > r.reservedUntil)
      await store.updateRedemption(redemptionId, [REDEMPTION_STATUS.reserved], { reservedUntil: wanted });
  }

  /** The reservation a payment event is about: by the metadata's id first, then by the session. */
  async function findFor(
    tx: Query,
    ref: { redemptionId?: string | null; checkoutRef?: string | null },
  ): Promise<Redemption | null> {
    const store = k.store(tx);
    return (
      (ref.redemptionId ? await store.redemptionById(ref.redemptionId) : null) ??
      (ref.checkoutRef ? await store.redemptionByCheckoutRef(ref.checkoutRef) : null)
    );
  }

  async function redeem(tx: Query, input: RedeemInput): Promise<"confirmed" | "already" | "unknown"> {
    const store = k.store(tx);
    const found = await findFor(tx, input);
    if (!found) return "unknown";
    const coupon = (await store.couponById(found.couponId, true))!;
    const r = (await store.redemptionById(found.id))!;
    const withRef = input.paymentRef ? await store.redemptionByPaymentRef(input.paymentRef) : null;
    if (withRef || (r.status !== REDEMPTION_STATUS.reserved && r.status !== REDEMPTION_STATUS.released))
      return "already";
    const now = k.now();
    const others = (await store.usage(coupon.id, null, now)).total - (countsAsUse(r, now) ? 1 : 0);
    const late = r.status === REDEMPTION_STATUS.released;
    const overLimit = late || (coupon.maxRedemptions !== null && others + 1 > coupon.maxRedemptions);
    const done = await store.updateRedemption(r.id, [REDEMPTION_STATUS.reserved, REDEMPTION_STATUS.released], {
      status: REDEMPTION_STATUS.confirmed,
      paymentRef: input.paymentRef,
      amountPaidMinor: input.amountPaidMinor,
      amountDiscountMinor: input.amountDiscountMinor,
      currency: input.currency ?? r.currency,
      reservedUntil: null,
      confirmedAt: now,
      endedAt: null,
      overLimit,
    });
    if (!done) return "already";
    await confirmed(tx, coupon, done, others + 1);
    return "confirmed";
  }

  /** The audit line and the events of a confirmed use. */
  async function confirmed(tx: Query, coupon: Coupon, r: Redemption, usesNow: number): Promise<void> {
    await k.record(
      tx,
      SYSTEM,
      "coupon.redeemed",
      { type: "coupon", id: coupon.id },
      {
        redemptionId: r.id,
        kind: coupon.kind,
        overLimit: r.overLimit,
        amountPaidMinor: r.amountPaidMinor,
        amountDiscountMinor: r.amountDiscountMinor,
      },
    );
    await k.announce(tx, COUPON_EVENT.redeemed, `redeemed:${r.id}`, {
      redemptionId: r.id,
      couponId: coupon.id,
      kind: coupon.kind,
      purpose: coupon.purpose,
      partnerId: r.partnerId,
      amountPaidMinor: r.amountPaidMinor,
      amountDiscountMinor: r.amountDiscountMinor,
      currency: r.currency,
      credits: coupon.kind === KIND.credit ? coupon.credits : null,
      overLimit: r.overLimit,
    });
    if (coupon.maxRedemptions !== null && usesNow === coupon.maxRedemptions)
      await k.announce(tx, COUPON_EVENT.exhausted, `exhausted:${coupon.id}`, {
        couponId: coupon.id,
        partnerId: coupon.partnerId,
      });
  }

  async function release(tx: Query, ref: { redemptionId?: string; checkoutRef?: string }): Promise<boolean> {
    const found = await findFor(tx, ref);
    if (!found) return false;
    const done = await k.store(tx).updateRedemption(found.id, [REDEMPTION_STATUS.reserved], {
      status: REDEMPTION_STATUS.released,
      reservedUntil: null,
      endedAt: k.now(),
    });
    if (!done) return false;
    await k.announce(tx, COUPON_EVENT.released, `released:${done.id}`, {
      redemptionId: done.id,
      couponId: done.couponId,
    });
    return true;
  }

  async function releaseExpired(tx: Query): Promise<number> {
    const released = await k.store(tx).releaseExpired(k.now(), SWEEP_BATCH);
    for (const r of released)
      await k.announce(tx, COUPON_EVENT.released, `released:${r.id}`, { redemptionId: r.id, couponId: r.couponId });
    return released.length;
  }

  async function refund(
    tx: Query,
    input: { paymentRef?: string | null; invoiceRef?: string | null; amountRefunded: number },
  ): Promise<"refunded" | "already" | "unknown"> {
    const store = k.store(tx);
    const r =
      (input.paymentRef ? await store.redemptionByPaymentRef(input.paymentRef) : null) ??
      (input.invoiceRef ? await store.redemptionByPaymentRef(input.invoiceRef) : null);
    if (!r) return "unknown";
    const total = Math.max(r.amountRefundedMinor, input.amountRefunded);
    if (total === r.amountRefundedMinor) return "already";
    const full = r.amountPaidMinor !== null && r.amountPaidMinor > 0 && total >= r.amountPaidMinor;
    const restore = full && (await k.settings()).refundRestoresUse && !r.useRestored;
    const done = (await store.updateRedemption(r.id, null, {
      amountRefundedMinor: total,
      ...(restore ? { useRestored: true } : {}),
    }))!;
    await k.record(
      tx,
      SYSTEM,
      "coupon.refunded",
      { type: "coupon", id: r.couponId },
      { redemptionId: r.id, amountRefundedMinor: total, useRestored: done.useRestored },
    );
    await k.announce(tx, COUPON_EVENT.refunded, `refunded:${r.id}:${total}`, {
      redemptionId: r.id,
      couponId: r.couponId,
      partnerId: r.partnerId,
      amountRefundedMinor: total,
      currency: r.currency,
      useRestored: done.useRestored,
    });
    return "refunded";
  }

  async function redeemCredit(
    tx: Query,
    input: { code: string; accountId: string; idempotencyKey: string; ip?: string | null; hasPaidBefore?: boolean },
  ): Promise<CreditRedemption> {
    const credits = k.deps.credits;
    if (!credits)
      throw new CouponError(
        COUPON_ERROR.badSettings,
        "Credit coupons need the credits ledger in the module's dependencies",
      );
    await mustBeEnabled();
    await attempt(input);
    const coupon = await lookup(tx, input.code, true);
    const store = k.store(tx);
    const known = await store.redemptionByKey(input.idempotencyKey);
    if (known) return replayOf(known, coupon, input.accountId);
    await check(tx, coupon, {
      mode: "redeem",
      accountId: input.accountId,
      ...(input.hasPaidBefore === undefined ? {} : { hasPaidBefore: input.hasPaidBefore }),
    });
    const now = k.now();
    const expiresAt = addHours(now, coupon.creditsValidDays! * 24);
    const redemption: Redemption = {
      id: k.newId(),
      couponId: coupon.id,
      accountId: input.accountId,
      partnerId: coupon.partnerId,
      status: REDEMPTION_STATUS.confirmed,
      idempotencyKey: input.idempotencyKey,
      reservedUntil: null,
      checkoutRef: null,
      paymentRef: null,
      amountPaidMinor: null,
      amountDiscountMinor: null,
      amountRefundedMinor: 0,
      useRestored: false,
      currency: null,
      creditGrantId: null,
      overLimit: false,
      createdAt: now,
      confirmedAt: now,
      endedAt: null,
    };
    await store.insertRedemption(redemption);
    const { grantId } = await credits.grant(tx, {
      accountId: input.accountId,
      amount: coupon.credits!,
      capPerDay: coupon.capPerDay,
      capPerMonth: coupon.capPerMonth,
      expiresAt,
      onExhausted: coupon.onExhausted!,
      source: `coupon:${redemption.id}`,
      idempotencyKey: `coupon-${redemption.id}`,
    });
    const done = (await store.updateRedemption(redemption.id, null, { creditGrantId: grantId }))!;
    await confirmed(tx, coupon, done, (await store.usage(coupon.id, null, now)).total);
    return { redemptionId: done.id, grantId, credits: coupon.credits!, expiresAt, replayed: false };
  }

  function replayOf(known: Redemption, coupon: Coupon, accountId: string): CreditRedemption {
    if (known.couponId !== coupon.id || known.accountId !== accountId || !known.creditGrantId)
      throw new CouponError(COUPON_ERROR.keyReused, "This idempotency key was used for another coupon or account");
    return {
      redemptionId: known.id,
      grantId: known.creditGrantId,
      credits: coupon.credits!,
      expiresAt: addHours(known.createdAt, coupon.creditsValidDays! * 24),
      replayed: true,
    };
  }

  async function revoke(tx: Query, actor: Actor, redemptionId: string): Promise<void> {
    const store = k.store(tx);
    const r = await store.redemptionById(redemptionId);
    if (!r) throw new CouponError(COUPON_ERROR.redemptionNotFound, `No redemption ${redemptionId}`);
    if (r.status === REDEMPTION_STATUS.revoked) return;
    if (r.status !== REDEMPTION_STATUS.confirmed || !r.creditGrantId || !k.deps.credits)
      throw new CouponError(COUPON_ERROR.notRevocable, "Only a confirmed credit redemption can be revoked");
    await store.couponById(r.couponId, true);
    const done = await store.updateRedemption(r.id, [REDEMPTION_STATUS.confirmed], {
      status: REDEMPTION_STATUS.revoked,
      endedAt: k.now(),
    });
    if (!done) return;
    const { expired } = await k.deps.credits.expire(tx, r.creditGrantId);
    await k.record(
      tx,
      actor,
      "coupon.revoked",
      { type: "coupon", id: r.couponId },
      { redemptionId: r.id, creditsWrittenOff: expired },
    );
  }

  return { validate, apply, attachCheckout, redeem, release, releaseExpired, refund, redeemCredit, revoke };
}
