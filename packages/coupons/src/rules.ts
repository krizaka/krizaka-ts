import { randomInt } from "node:crypto";

import { isAfter } from "@krizaka/time";

import {
  type Coupon,
  COUPON_CODE,
  COUPON_ERROR,
  COUPON_STATUS,
  CouponError,
  type CouponRefusal,
  type CouponSettings,
  type DiscountTerms,
  DURATION,
  KIND,
  ON_EXHAUSTED,
  PURPOSE,
  type Redemption,
  REDEMPTION_STATUS,
  type Usage,
} from "./port";

/** Defaults and bounds of the settings (the admin changes them without a redeploy). `maxPercentOff`'s default is Oussama's call (krizaka-ts#61). */
export const COUPON_DEFAULTS: CouponSettings = {
  enabled: false,
  reservationMinutes: 60,
  attemptsPerAccountPerHour: 10,
  attemptsPerIpPerHour: 30,
  minCodeLength: 8,
  generatedCodeLength: 10,
  maxPercentOff: 50,
  refundRestoresUse: false,
};

/** The action name of the limiter for attempts with a code: each `validate`, `apply` and `redeemCredit` counts one hit. */
export const COUPON_ATTEMPT_ACTION = "couponAttempt";

/** [min, max] of each numeric setting. */
export const COUPON_BOUNDS = {
  reservationMinutes: [40, 1440],
  attemptsPerAccountPerHour: [1, 100],
  attemptsPerIpPerHour: [1, 500],
  minCodeLength: [4, 40],
  generatedCodeLength: [8, 20],
  maxPercentOff: [1, 99],
} as const satisfies Record<string, readonly [number, number]>;

/** Checks the settings the service was given. @throws CouponError `COUPON_BAD_SETTINGS` */
export function checkSettings(s: CouponSettings): CouponSettings {
  for (const [key, [min, max]] of Object.entries(COUPON_BOUNDS)) {
    const value = s[key as keyof typeof COUPON_BOUNDS];
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new CouponError(COUPON_ERROR.badSettings, `${key} is ${min} to ${max}, got ${value}`);
  }
  return s;
}

const bad = (message: string) => new CouponError(COUPON_ERROR.badInput, message);

// @fixed: the longest normalised code the table accepts (its CHECK)
const MAX_CODE = 40;
// @fixed: the shortest normalised code the table accepts (its CHECK); the admin's `coupons.minCodeLength` raises it
const MIN_CODE = 4;

/**
 * The lookup key of a code: upper case, without spaces, hyphens or underscores, so « summer-2026 », « SUMMER 2026 » and « Summer2026 »
 * are one code. A code is then letters and digits only.
 * @returns the key, or null when what is left is empty, too long or not letters and digits
 */
export function normalizeCode(input: string): string | null {
  const key = input.normalize("NFKC").replace(/[\s\-_]+/g, "").toUpperCase();
  return /^[A-Z0-9]+$/.test(key) && key.length >= 1 && key.length <= MAX_CODE ? key : null;
}

// Crockford's base32 without I, L, O and U: nothing to confuse when read out loud or copied by hand.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A random code of `length` characters from an alphabet without I, L, O, U (about 5 bits each). */
export function generateCode(length: number, pick: (max: number) => number = (max) => randomInt(max)): string {
  return Array.from({ length }, () => ALPHABET[pick(ALPHABET.length)]).join("");
}

/** Whether a redemption consumes a use at `now`: confirmed or revoked and not restored, or reserved and not yet past its deadline. */
export function countsAsUse(r: Pick<Redemption, "status" | "useRestored" | "reservedUntil">, now: Date): boolean {
  if (r.status === REDEMPTION_STATUS.confirmed || r.status === REDEMPTION_STATUS.revoked) return !r.useRestored;
  return r.status === REDEMPTION_STATUS.reserved && r.reservedUntil !== null && isAfter(r.reservedUntil, now);
}

/** What the person typed and where they are: a checkout (discount codes) or a place that redeems credits (credit codes). */
export interface CheckoutContext {
  mode: "checkout" | "redeem";
  accountId: string;
  /** The plan kind being bought. Checkout only. */
  plan?: string;
  /** The price before the discount, in minor units. Checkout only. */
  amountMinor?: number;
  currency?: string;
  /** Whether the account has paid before (from `payments`). */
  hasPaidBefore?: boolean;
  /** False when the product's provider cannot apply discounts (CCBill, Segpay). Default true. */
  providerSupportsDiscounts?: boolean;
  ip?: string | null;
}

export interface DiscountEffect {
  kind: typeof KIND.discount;
  percentOffBp: number | null;
  amountOffMinor: number | null;
  currency: string | null;
  duration: NonNullable<Coupon["duration"]>;
  durationMonths: number | null;
  /** What the first payment loses, in minor units. */
  discountMinor: number;
  payableMinor: number;
}

export interface CreditEffect {
  kind: typeof KIND.credit;
  credits: number;
  capPerDay: number | null;
  capPerMonth: number | null;
  validDays: number;
  onExhausted: NonNullable<Coupon["onExhausted"]>;
}

/** What a code gives, in numbers. Informational for a discount: the provider computes the real amount and its taxes. */
export function effectOf(coupon: Coupon, amountMinor: number): DiscountEffect | CreditEffect {
  if (coupon.kind === KIND.credit) {
    return { kind: KIND.credit, credits: coupon.credits!, capPerDay: coupon.capPerDay, capPerMonth: coupon.capPerMonth, validDays: coupon.creditsValidDays!, onExhausted: coupon.onExhausted! };
  }
  const raw = coupon.percentOffBp !== null ? Math.round((amountMinor * coupon.percentOffBp) / 10_000) : coupon.amountOffMinor!;
  const discountMinor = Math.min(raw, amountMinor);
  return { kind: KIND.discount, percentOffBp: coupon.percentOffBp, amountOffMinor: coupon.amountOffMinor, currency: coupon.currency, duration: coupon.duration!, durationMonths: coupon.durationMonths, discountMinor, payableMinor: amountMinor - discountMinor };
}

/** The immutable terms a provider adapter turns into its object. */
export function termsOf(coupon: Coupon): DiscountTerms {
  return {
    couponId: coupon.id,
    termsVersion: coupon.termsVersion,
    ...(coupon.percentOffBp !== null ? { percentOffBp: coupon.percentOffBp } : { amountOffMinor: coupon.amountOffMinor!, currency: coupon.currency! }),
    duration: coupon.duration!,
    ...(coupon.durationMonths !== null ? { durationMonths: coupon.durationMonths } : {}),
  };
}

/** The window, the status and the limits: what any coupon is checked against. */
function commonRefusal(coupon: Coupon, ctx: CheckoutContext, usage: Usage, now: Date): CouponRefusal | null {
  if (isAfter(coupon.startsAt, now)) return COUPON_CODE.notStarted;
  if (coupon.endsAt !== null && !isAfter(coupon.endsAt, now)) return COUPON_CODE.expired;
  if (coupon.status !== COUPON_STATUS.active) return COUPON_CODE.paused;
  if (coupon.maxRedemptions !== null && usage.total >= coupon.maxRedemptions) return COUPON_CODE.exhausted;
  if (usage.account >= coupon.maxPerAccount) return COUPON_CODE.accountLimit;
  if (coupon.newCustomersOnly && ctx.hasPaidBefore) return COUPON_CODE.newCustomersOnly;
  return null;
}

/** What only a discount is checked against: the provider, the plan, the minimum, the currency and the bound on its size. */
function discountRefusal(coupon: Coupon, ctx: CheckoutContext, settings: CouponSettings): CouponRefusal | null {
  const amount = ctx.amountMinor ?? 0;
  if (ctx.providerSupportsDiscounts === false) return COUPON_CODE.provider;
  if (coupon.plans.length > 0 && !coupon.plans.includes(ctx.plan ?? "")) return COUPON_CODE.notForPlan;
  if (coupon.minimumMinor !== null && amount < coupon.minimumMinor) return COUPON_CODE.minimum;
  if (coupon.currency !== null && coupon.currency !== ctx.currency) return COUPON_CODE.currency;
  const tooLarge = coupon.percentOffBp !== null ? coupon.percentOffBp > settings.maxPercentOff * 100 : coupon.amountOffMinor! * 100 > amount * settings.maxPercentOff;
  return tooLarge ? COUPON_CODE.tooLarge : null;
}

/** The first rule a code breaks for a context at `now`, or none. The order is the order of the refusals' table. */
export function refusalOf(coupon: Coupon, ctx: CheckoutContext, usage: Usage, now: Date, settings: CouponSettings): CouponRefusal | null {
  const discount = coupon.kind === KIND.discount;
  if (discount !== (ctx.mode === "checkout")) return COUPON_CODE.kind;
  return commonRefusal(coupon, ctx, usage, now) ?? (discount ? discountRefusal(coupon, ctx, settings) : null);
}

/** What the admin gives to create a coupon (the kind decides which terms are required). */
export interface NewCoupon {
  code: string;
  kind: Coupon["kind"];
  purpose: Coupon["purpose"];
  partnerId?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
  maxPerAccount?: number;
  newCustomersOnly?: boolean;
  plans?: string[];
  percentOffBp?: number | null;
  amountOffMinor?: number | null;
  currency?: string | null;
  duration?: Coupon["duration"];
  durationMonths?: number | null;
  minimumMinor?: number | null;
  credits?: number | null;
  capPerDay?: number | null;
  capPerMonth?: number | null;
  creditsValidDays?: number | null;
  onExhausted?: Coupon["onExhausted"];
}

const pos = (n: number | null | undefined, what: string, max = Number.MAX_SAFE_INTEGER) => {
  if (n === null || n === undefined) return;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw bad(`${what} is a whole number from 1 to ${max}, got ${n}`);
};

/**
 * Checks a coupon against the rules of the table and of the product's settings, so a bad one never reaches the database.
 * A free offer is always a capped credit coupon: a discount is never 100 %, a fixed amount never runs forever.
 * @throws CouponError `COUPON_BAD_INPUT`
 */
export function checkCoupon(c: Coupon | (NewCoupon & { codeKey?: string }), settings: CouponSettings): void {
  const code = c.code.trim();
  const key = normalizeCode(code);
  if (!key || key.length < Math.max(MIN_CODE, settings.minCodeLength)) throw bad(`A code is letters and digits, ${Math.max(MIN_CODE, settings.minCodeLength)} to ${MAX_CODE} characters`);
  if (c.kind !== KIND.discount && c.kind !== KIND.credit) throw bad("A coupon is a discount or a credit");
  if (!Object.values(PURPOSE).includes(c.purpose)) throw bad("A purpose is partner, promo, demo or support");
  if ((c.purpose === PURPOSE.partner) !== Boolean(c.partnerId)) throw bad("A partner coupon names its partner, and only a partner coupon does");
  if (!(c.startsAt instanceof Date) || Number.isNaN(c.startsAt.valueOf())) throw bad("A coupon starts on a date");
  if (c.endsAt && !isAfter(c.endsAt, c.startsAt)) throw bad("A coupon ends after it starts");
  pos(c.maxRedemptions, "maxRedemptions");
  pos(c.maxPerAccount, "maxPerAccount");
  if (c.kind === KIND.discount) return checkDiscount(c, settings);
  return checkCredit(c);
}

function checkDiscount(c: NewCoupon, settings: CouponSettings): void {
  if (c.credits != null || c.capPerDay != null || c.capPerMonth != null || c.creditsValidDays != null || c.onExhausted != null) throw bad("A discount carries no credit terms");
  const percent = c.percentOffBp != null;
  const amount = c.amountOffMinor != null;
  if (percent === amount) throw bad("A discount is a percentage or a fixed amount, never both");
  if (percent) pos(c.percentOffBp, "percentOffBp", Math.min(9999, settings.maxPercentOff * 100));
  if (amount) {
    pos(c.amountOffMinor, "amountOffMinor");
    if (!/^[a-z]{3}$/.test(c.currency ?? "")) throw bad("A fixed amount has a lowercase currency");
  }
  if (!c.duration || !Object.values(DURATION).includes(c.duration)) throw bad("A discount has a duration: once, repeating or forever");
  if ((c.duration === DURATION.repeating) !== (c.durationMonths != null)) throw bad("Only a repeating discount names its months");
  pos(c.durationMonths, "durationMonths", 36);
  if (amount && c.duration === DURATION.forever) throw bad("A fixed amount never runs forever");
  if (c.minimumMinor != null && (!Number.isSafeInteger(c.minimumMinor) || c.minimumMinor < 0)) throw bad("A minimum is a non-negative whole number");
  if (c.currency != null && !/^[a-z]{3}$/.test(c.currency)) throw bad("A currency is three lowercase letters");
}

function checkCredit(c: NewCoupon): void {
  if (c.percentOffBp != null || c.amountOffMinor != null || c.duration != null || c.durationMonths != null || c.minimumMinor != null) throw bad("A credit coupon carries no discount terms");
  pos(c.credits, "credits");
  if (c.credits == null) throw bad("A credit coupon grants credits: a free offer is always a capped credit coupon");
  pos(c.capPerDay, "capPerDay");
  pos(c.capPerMonth, "capPerMonth");
  if (c.creditsValidDays == null) throw bad("Every grant expires: set creditsValidDays");
  pos(c.creditsValidDays, "creditsValidDays", 3650);
  if (c.onExhausted !== ON_EXHAUSTED.stop && c.onExhausted !== ON_EXHAUSTED.fallbackPaid) throw bad("onExhausted is stop or fallback_paid");
}
