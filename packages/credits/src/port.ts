/**
 * The ports of « credits »: ONE ledger of usage credits per account. Generic: no product import, no database client (a `Query`
 * comes in), no wall clock (a `Clock` comes in). Credits are integers (never floats). The ledger is append-only and the balance is
 * DERIVED from it: nothing stores a balance that could drift.
 *
 * Two kinds of credit live in it. A GRANT is free usage (a coupon, a monthly allowance, a demo): it expires, may be capped per day or
 * month, and says what happens when it runs out (`stop`, or `fallback_paid`: go on with what the person bought). A PURCHASE is paid
 * usage: it does not expire and is never capped.
 */
export type { Clock, Query } from "@krizaka/db";

export const BUCKET = { granted: "granted", purchased: "purchased" } as const;
export type Bucket = (typeof BUCKET)[keyof typeof BUCKET];

/** What happens when a grant has run out: refuse (`stop`), or move on to purchased credits (`fallback_paid`). */
export const ON_EXHAUSTED = { stop: "stop", fallbackPaid: "fallback_paid" } as const;
export type OnExhausted = (typeof ON_EXHAUSTED)[keyof typeof ON_EXHAUSTED];

/** The kinds of line of the ledger. Amounts are signed: credits in are positive, credits out negative. */
export const ENTRY_TYPE = {
  grant: "GRANT",
  purchase: "PURCHASE",
  debit: "DEBIT",
  refund: "REFUND",
  expiry: "EXPIRY",
  adjustment: "ADJUSTMENT",
} as const;
export type EntryType = (typeof ENTRY_TYPE)[keyof typeof ENTRY_TYPE];

export const HOLD_STATUS = { active: "active", settled: "settled", released: "released" } as const;
export type HoldStatus = (typeof HOLD_STATUS)[keyof typeof HOLD_STATUS];

/** A pot of credits. Immutable: what is left of it is derived from the ledger. */
export interface Grant {
  id: string;
  accountId: string;
  bucket: Bucket;
  /** What it started with. */
  amount: number;
  /** The most it gives in a calendar day (in the settings' time zone), or none. Granted only. */
  capPerDay: number | null;
  /** The most it gives in a calendar month, or none. Granted only. */
  capPerMonth: number | null;
  /** When it lapses. Required for a granted pot, none for a purchased one. */
  expiresAt: Date | null;
  onExhausted: OnExhausted;
  /** Where it comes from (`coupon:<redemptionId>`, `plan:monthly`, `purchase:<paymentRef>`). */
  source: string;
  createdAt: Date;
}

/** One line of the ledger. */
export interface Entry {
  id: string;
  accountId: string;
  grantId: string | null;
  type: EntryType;
  /** Signed. */
  amount: number;
  reason: string;
  /** The caller's key for the whole operation: a replay finds its lines. */
  operation: string;
  /** Unique: `<operation>:<n>`. */
  idempotencyKey: string;
  /** For a REFUND: the operation it gives back. */
  reverses: string | null;
  holdId: string | null;
  at: Date;
}

export interface Hold {
  id: string;
  accountId: string;
  amount: number;
  expiresAt: Date;
  status: HoldStatus;
  /** What it settled for, when settled. */
  settledAmount: number | null;
  createdAt: Date;
  closedAt: Date | null;
  operation: string;
}

/** A grant as the planner sees it: what is left, what it gave today and this month, and whether it was closed by an expiry line. */
export interface GrantState {
  grant: Grant;
  remaining: number;
  usedToday: number;
  usedThisMonth: number;
  /** An EXPIRY line closed it (revoked, or swept after its date). */
  closed: boolean;
}

/** The calendar the caps are counted in: the zone, and the local day and month of « now » in it (`2026-10-26`, `2026-10`). */
export interface Calendar {
  timeZone: string;
  day: string;
  month: string;
}

/** Where the ledger lives. Every adapter runs `creditStoreContract` (`@krizaka/credits/testkit`). Times come from the caller. */
export interface CreditStore {
  /** Serialises the writers of one account until the transaction ends (an advisory lock). Call it before reading to decide. */
  lock(accountId: string): Promise<void>;
  insertGrant(grant: Grant): Promise<void>;
  grantById(grantId: string): Promise<Grant | null>;
  /** The account's grants, with what is left and what each gave in the calendar's day and month. Includes lapsed and closed ones. */
  grantStates(accountId: string, calendar: Calendar): Promise<GrantState[]>;
  /** Writes lines. A duplicate `idempotencyKey` is a bug of the caller (it checked `entriesOf` first, under the lock) and throws. */
  insertEntries(entries: Entry[]): Promise<void>;
  /** The lines of one operation, in order. */
  entriesOf(operation: string): Promise<Entry[]>;
  /** The lines of the account, newest first. */
  history(accountId: string, options: { limit: number; before?: Date }): Promise<Entry[]>;
  insertHold(hold: Hold): Promise<void>;
  holdById(holdId: string): Promise<Hold | null>;
  holdByOperation(operation: string): Promise<Hold | null>;
  /** What the account's active holds that have not expired at `now` keep back, except `exceptHoldId`. */
  heldAmount(accountId: string, now: Date, exceptHoldId?: string): Promise<number>;
  closeHold(
    holdId: string,
    status: typeof HOLD_STATUS.settled | typeof HOLD_STATUS.released,
    settledAmount: number | null,
    at: Date,
  ): Promise<void>;
  /** Granted pots past their date that still hold credits and no EXPIRY line, oldest first. */
  lapsedWithCredits(now: Date, limit: number): Promise<{ grantId: string; accountId: string }[]>;
}

/** The knobs of the ledger, read from the admin's settings (`@krizaka/credits/settings`). */
export interface CreditsSettings {
  /** The IANA zone that days and months are counted in. */
  timeZone: string;
  /** Seconds a hold keeps credits back when the caller names no lifetime. */
  holdTtlSeconds: number;
}

/** Stable codes of the refusals of this package. */
export const CREDITS_CODE = {
  capDay: "CREDITS_CAP_DAY",
  capMonth: "CREDITS_CAP_MONTH",
  exhausted: "CREDITS_EXHAUSTED",
  paywall: "PAYWALL",
  badAmount: "CREDITS_BAD_AMOUNT",
  badGrant: "CREDITS_BAD_GRANT",
  badKey: "CREDITS_BAD_KEY",
  badSettings: "CREDITS_BAD_SETTINGS",
  unknownGrant: "CREDITS_UNKNOWN_GRANT",
  unknownHold: "CREDITS_UNKNOWN_HOLD",
  holdClosed: "CREDITS_HOLD_CLOSED",
  keyReused: "CREDITS_KEY_REUSED",
  nothingToRefund: "CREDITS_NOTHING_TO_REFUND",
} as const;
export type CreditsCode = (typeof CREDITS_CODE)[keyof typeof CREDITS_CODE];

/** The HTTP status a route may answer for each refusal. */
export const CREDITS_STATUS: Record<CreditsCode, number> = {
  CREDITS_CAP_DAY: 429,
  CREDITS_CAP_MONTH: 429,
  CREDITS_EXHAUSTED: 402,
  PAYWALL: 402,
  CREDITS_BAD_AMOUNT: 400,
  CREDITS_BAD_GRANT: 400,
  CREDITS_BAD_KEY: 400,
  CREDITS_BAD_SETTINGS: 500,
  CREDITS_UNKNOWN_GRANT: 404,
  CREDITS_UNKNOWN_HOLD: 404,
  CREDITS_HOLD_CLOSED: 409,
  CREDITS_KEY_REUSED: 409,
  CREDITS_NOTHING_TO_REFUND: 404,
};

/** A refusal: a stable `code`, the HTTP `status` a route may answer, and a message. */
export class CreditsError extends Error {
  readonly status: number;
  constructor(
    readonly code: CreditsCode,
    message: string,
  ) {
    super(message);
    this.name = "CreditsError";
    this.status = CREDITS_STATUS[code];
  }
}
