/**
 * The ports of « coupons » (ADR-002): discount and credit coupons that the admin manages, with the product's database as the source
 * of truth. Generic: no product import, no vendor, no database client (a `Query` comes in), no wall clock (a `Clock` comes in), no
 * network. The provider is `@krizaka/payments`' port (this module hands it immutable DiscountTerms); credits are
 * `@krizaka/credits`' ledger; the audit trail, the outbox and the limiter are structural ports, so this package depends on none of them.
 */
import type { Clock, Query } from "@krizaka/db";

export type { Clock, Query };

export const KIND = { discount: "discount", credit: "credit" } as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

/** Why the coupon exists: a person who sells for us, a public promotion, a demo, a support gesture. */
export const PURPOSE = { partner: "partner", promo: "promo", demo: "demo", support: "support" } as const;
export type Purpose = (typeof PURPOSE)[keyof typeof PURPOSE];

/** Stored states. « Not started », « expired » and « exhausted » are COMPUTED from the dates and the uses, so no cron is needed. */
export const COUPON_STATUS = { active: "active", paused: "paused", archived: "archived" } as const;
export type CouponStatus = (typeof COUPON_STATUS)[keyof typeof COUPON_STATUS];

export const REDEMPTION_STATUS = {
  reserved: "reserved",
  confirmed: "confirmed",
  released: "released",
  revoked: "revoked",
} as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUS)[keyof typeof REDEMPTION_STATUS];

export const DURATION = { once: "once", repeating: "repeating", forever: "forever" } as const;
export type Duration = (typeof DURATION)[keyof typeof DURATION];

export const ON_EXHAUSTED = { stop: "stop", fallbackPaid: "fallback_paid" } as const;
export type OnExhausted = (typeof ON_EXHAUSTED)[keyof typeof ON_EXHAUSTED];

/** The terms a provider adapter needs to apply a discount: vendor-free, IMMUTABLE per `(couponId, termsVersion)` (`@krizaka/payments`' `DiscountTerms`). */
export interface DiscountTerms {
  couponId: string;
  termsVersion: number;
  percentOffBp?: number;
  amountOffMinor?: number;
  currency?: string;
  duration: Duration;
  durationMonths?: number;
}

export interface Coupon {
  id: string;
  /** As the admin typed it. */
  code: string;
  /** Normalised (upper case, no spaces or hyphens): the lookup key, unique in the product. */
  codeKey: string;
  kind: Kind;
  purpose: Purpose;
  partnerId: string | null;
  status: CouponStatus;
  startsAt: Date;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerAccount: number;
  newCustomersOnly: boolean;
  /** Plan kinds of the product; empty = all. */
  plans: string[];
  percentOffBp: number | null;
  amountOffMinor: number | null;
  currency: string | null;
  duration: Duration | null;
  durationMonths: number | null;
  minimumMinor: number | null;
  credits: number | null;
  capPerDay: number | null;
  capPerMonth: number | null;
  creditsValidDays: number | null;
  onExhausted: OnExhausted | null;
  termsVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
}

export interface Partner {
  id: string;
  /** Null once erased (Loi 25). */
  displayName: string | null;
  contactEmail: string | null;
  status: "active" | "archived";
  createdAt: Date;
  createdBy: string | null;
  erasedAt: Date | null;
}

export interface Redemption {
  id: string;
  couponId: string;
  /** Null once the account was deleted: the use still counts and the revenue stays. */
  accountId: string | null;
  /** Copied at redemption: attribution never moves. */
  partnerId: string | null;
  status: RedemptionStatus;
  idempotencyKey: string;
  reservedUntil: Date | null;
  checkoutRef: string | null;
  paymentRef: string | null;
  amountPaidMinor: number | null;
  amountDiscountMinor: number | null;
  /** CUMULATIVE, partial or full. */
  amountRefundedMinor: number;
  /** A full refund gave the use back (the setting). */
  useRestored: boolean;
  currency: string | null;
  creditGrantId: string | null;
  /** A late payment honoured past a limit. */
  overLimit: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
  endedAt: Date | null;
}

/** What a guarded update may change. */
export type RedemptionPatch = Partial<
  Pick<
    Redemption,
    | "status"
    | "reservedUntil"
    | "checkoutRef"
    | "paymentRef"
    | "amountPaidMinor"
    | "amountDiscountMinor"
    | "amountRefundedMinor"
    | "useRestored"
    | "currency"
    | "creditGrantId"
    | "overLimit"
    | "confirmedAt"
    | "endedAt"
  >
>;

/** What a coupon's terms and rules may be changed to (the admin's update). */
export type CouponPatch = Partial<Omit<Coupon, "id" | "codeKey" | "createdAt" | "createdBy" | "updatedAt" | "kind">>;

export interface Usage {
  /** Uses that count overall. */
  total: number;
  /** Uses that count for the account. */
  account: number;
}

export interface CouponFilter {
  status?: CouponStatus;
  kind?: Kind;
  purpose?: Purpose;
  partnerId?: string;
  limit: number;
  offset: number;
}

export interface RedemptionFilter {
  couponId?: string;
  partnerId?: string;
  status?: RedemptionStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

/** One row of the partner view: a coupon's uses in a period, in one currency. Never a customer's identity. */
export interface PartnerRow {
  couponId: string;
  code: string;
  currency: string | null;
  redemptions: number;
  discountMinor: number;
  /** Paid minus refunded. */
  revenueMinor: number;
  creditsGranted: number;
}

/** Where coupons live. Every adapter runs `couponsContract` (`@krizaka/coupons/testkit`). Times come from the caller. */
export interface CouponStore {
  insertCoupon(coupon: Coupon): Promise<void>;
  /** `forUpdate` locks the row until the transaction ends: the last use is taken by one request at a time. */
  couponById(id: string, forUpdate?: boolean): Promise<Coupon | null>;
  couponByKey(codeKey: string, forUpdate?: boolean): Promise<Coupon | null>;
  updateCoupon(id: string, patch: CouponPatch, at: Date): Promise<Coupon | null>;
  listCoupons(filter: CouponFilter): Promise<Coupon[]>;
  /** Whether any redemption (even released) exists: the terms are locked once there is one. */
  hasRedemptions(couponId: string): Promise<boolean>;
  insertPartner(partner: Partner): Promise<void>;
  partnerById(id: string): Promise<Partner | null>;
  updatePartner(
    id: string,
    patch: Partial<Pick<Partner, "displayName" | "contactEmail" | "status" | "erasedAt">>,
  ): Promise<Partner | null>;
  listPartners(options: { includeArchived: boolean; limit: number; offset: number }): Promise<Partner[]>;
  insertRedemption(redemption: Redemption): Promise<void>;
  redemptionById(id: string): Promise<Redemption | null>;
  redemptionByKey(idempotencyKey: string): Promise<Redemption | null>;
  redemptionByCheckoutRef(checkoutRef: string): Promise<Redemption | null>;
  redemptionByPaymentRef(paymentRef: string): Promise<Redemption | null>;
  /** The guarded transition: applies the patch only if the redemption is in one of `from`. Answers the new row, or null when the guard failed. */
  updateRedemption(
    id: string,
    from: readonly RedemptionStatus[] | null,
    patch: RedemptionPatch,
  ): Promise<Redemption | null>;
  /** The uses that count (see `countsAsUse`), overall and for the account, at `now`. */
  usage(couponId: string, accountId: string | null, now: Date): Promise<Usage>;
  listRedemptions(filter: RedemptionFilter): Promise<Redemption[]>;
  /** Releases the reservations past `reserved_until` and answers them. */
  releaseExpired(now: Date, limit: number): Promise<Redemption[]>;
  partnerReport(partnerId: string, period: { from?: Date; to?: Date }, now: Date): Promise<PartnerRow[]>;
  /** Active coupons with a fixed amount (for `checkPrices`). */
  activeAmountCoupons(): Promise<Coupon[]>;
}

/** The knobs of the module, read from the admin's settings (`@krizaka/coupons/settings`). */
export interface CouponSettings {
  /** Shows the field and accepts codes. */
  enabled: boolean;
  /** How long a checkout holds a use (40 to 1440 minutes: the provider's session window). */
  reservationMinutes: number;
  attemptsPerAccountPerHour: number;
  attemptsPerIpPerHour: number;
  minCodeLength: number;
  generatedCodeLength: number;
  /** The highest percent a discount may have (1 to 99). */
  maxPercentOff: number;
  /** A full refund gives the use back. */
  refundRestoresUse: boolean;
}

/** Who acts (for the audit trail). */
export interface Actor {
  id: string | null;
  label: string;
}

/** The trail (`@krizaka/audit`'s `Audit`), structurally. */
export interface AuditPort {
  record(
    query: Query,
    entry: {
      actorId: string | null;
      actorLabel: string;
      action: string;
      target?: { type: string; id: string } | null;
      detail?: Record<string, unknown>;
    },
  ): Promise<void>;
}

/** The outbox (`@krizaka/outbox`'s `Outbox`), structurally. */
export interface OutboxPort {
  append(
    tx: Query,
    message: { topic: string; type: string; payload: unknown; id?: string },
  ): Promise<{ id: string; appended: boolean }>;
}

/** The limiter (`@krizaka/rate-limit`'s `Limiter`), structurally. */
export interface RateLimitPort {
  check(
    action: string,
    keys: { ip?: string | null | undefined; subject?: string | null | undefined },
  ): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>;
}

/** The credits ledger (`@krizaka/credits`' `Credits`), structurally. */
export interface CreditsPort {
  grant(
    tx: Query,
    input: {
      accountId: string;
      amount: number;
      expiresAt: Date;
      capPerDay?: number | null;
      capPerMonth?: number | null;
      onExhausted: OnExhausted;
      source: string;
      idempotencyKey: string;
    },
  ): Promise<{ grantId: string; replayed: boolean }>;
  expire(tx: Query, grantId: string): Promise<{ expired: number }>;
}

/** The refusals of validation and redemption (typed, `as const`). */
export const COUPON_CODE = {
  unknown: "COUPON_UNKNOWN",
  notStarted: "COUPON_NOT_STARTED",
  expired: "COUPON_EXPIRED",
  paused: "COUPON_PAUSED",
  exhausted: "COUPON_EXHAUSTED",
  accountLimit: "COUPON_ACCOUNT_LIMIT",
  newCustomersOnly: "COUPON_NEW_CUSTOMERS_ONLY",
  notForPlan: "COUPON_NOT_FOR_PLAN",
  minimum: "COUPON_MINIMUM",
  currency: "COUPON_CURRENCY",
  tooLarge: "COUPON_TOO_LARGE",
  kind: "COUPON_KIND",
  provider: "COUPON_PROVIDER",
  rateLimited: "COUPON_RATE_LIMITED",
  disabled: "COUPON_DISABLED",
} as const;
export type CouponRefusal = (typeof COUPON_CODE)[keyof typeof COUPON_CODE];

/** The errors of the admin and of the flows (not refusals of a customer's code). */
export const COUPON_ERROR = {
  badInput: "COUPON_BAD_INPUT",
  codeTaken: "COUPON_CODE_TAKEN",
  termsLocked: "COUPON_TERMS_LOCKED",
  notFound: "COUPON_NOT_FOUND",
  redemptionNotFound: "COUPON_REDEMPTION_NOT_FOUND",
  partnerNotFound: "COUPON_PARTNER_NOT_FOUND",
  keyReused: "COUPON_KEY_REUSED",
  notRevocable: "COUPON_NOT_REVOCABLE",
  badSettings: "COUPON_BAD_SETTINGS",
} as const;
export type CouponErrorCode = (typeof COUPON_ERROR)[keyof typeof COUPON_ERROR];

/** The HTTP status a route may answer for each refusal or error. */
export const COUPON_STATUS_CODE: Record<CouponRefusal | CouponErrorCode, number> = {
  COUPON_UNKNOWN: 404,
  COUPON_NOT_STARTED: 422,
  COUPON_EXPIRED: 422,
  COUPON_PAUSED: 422,
  COUPON_EXHAUSTED: 422,
  COUPON_ACCOUNT_LIMIT: 422,
  COUPON_NEW_CUSTOMERS_ONLY: 422,
  COUPON_NOT_FOR_PLAN: 422,
  COUPON_MINIMUM: 422,
  COUPON_CURRENCY: 422,
  COUPON_TOO_LARGE: 422,
  COUPON_KIND: 422,
  COUPON_PROVIDER: 422,
  COUPON_RATE_LIMITED: 429,
  COUPON_DISABLED: 404,
  COUPON_BAD_INPUT: 400,
  COUPON_CODE_TAKEN: 409,
  COUPON_TERMS_LOCKED: 409,
  COUPON_NOT_FOUND: 404,
  COUPON_REDEMPTION_NOT_FOUND: 404,
  COUPON_PARTNER_NOT_FOUND: 404,
  COUPON_KEY_REUSED: 409,
  COUPON_NOT_REVOCABLE: 409,
  COUPON_BAD_SETTINGS: 500,
};

/** A refusal thrown by a flow (`apply`, `redeemCredit`): a stable `code`, the HTTP `status`, and `retryAfterSeconds` for a rate limit. */
export class CouponError extends Error {
  readonly status: number;
  constructor(
    readonly code: CouponRefusal | CouponErrorCode,
    message: string = code,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CouponError";
    this.status = COUPON_STATUS_CODE[code];
  }
}
