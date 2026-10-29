/**
 * The ports of « rate-limit »: nothing here knows a request, a database client, an environment variable or the wall clock. The
 * product extracts the keys (an address, a subject) and the limiter counts them.
 */

/** The state of a counter's window after a hit: how many hits it holds, and when it ends. */
export interface BucketHit {
  count: number;
  resetAt: Date;
}

/**
 * Where counters live: a fixed window per key, started by its first hit and lasting `windowSeconds`. A hit after the window ended
 * starts a new one. Adapters: `memoryLimitStore` (one process) and `dbLimitStore` (shared by every instance).
 */
export interface LimitStore {
  /** Counts one hit on `key` and returns the window it fell in. Atomic: concurrent hits are counted exactly. */
  hit(key: string, windowSeconds: number, now: Date): Promise<BucketHit>;
  /** The open window of `key`, without counting; null when none is open. */
  peek(key: string, now: Date): Promise<BucketHit | null>;
  /** Opens (or replaces) a window holding `count` that ends `seconds` from now: a lock-out. */
  set(key: string, count: number, seconds: number, now: Date): Promise<void>;
  /** Forgets `key` (a successful sign-in clears its failures). */
  reset(key: string): Promise<void>;
  /** Drops the windows that ended; returns how many. The product's job calls it. */
  purge(now: Date): Promise<number>;
}

/** What one action allows in one window. Each of `perIp` and `perSubject` is optional: absent means that key is not limited. */
export interface ActionLimit {
  /** Hits an address may make in the window. */
  perIp?: number;
  /** Hits a subject (an e-mail address, an account id) may make in the window. */
  perSubject?: number;
  /** The window's length in seconds. */
  windowSeconds: number;
}

/**
 * The limits, by action: a table, or a function that answers for an action (so the product can read them from its settings at each
 * check). `undefined` for an action nobody declared is a programming error and throws.
 */
export type LimitsSource =
  | Readonly<Record<string, ActionLimit>>
  | ((action: string) => ActionLimit | undefined | Promise<ActionLimit | undefined>);

/** The keys one check counts. The limiter receives keys, never a request: extract the address with `clientIp` of `@krizaka/auth`. */
export interface LimitKeys {
  /** The client's address; null (unknown) is counted under `unknown`, like the copies did. */
  ip?: string | null | undefined;
  /** The subject: an address, an account. Compared in lower case. Counted only when the action has a `perSubject` limit. */
  subject?: string | null | undefined;
}

/** A hit allowed, or refused with when to come back. */
export type CheckResult = { ok: true } | { ok: false; retryAfterSeconds: number; scope: "ip" | "subject" };

/** Stable codes of this package's errors. */
export const RATE_LIMIT_CODE = {
  limited: "RATE_LIMITED",
  noLimits: "RATE_LIMIT_NO_LIMITS",
  badLimit: "RATE_LIMIT_BAD_LIMIT",
} as const;
export type RateLimitCode = (typeof RATE_LIMIT_CODE)[keyof typeof RATE_LIMIT_CODE];

/** A refusal: HTTP 429, with the seconds to wait (the `Retry-After` header). */
export class RateLimited extends Error {
  readonly status = 429;
  readonly code = RATE_LIMIT_CODE.limited;
  constructor(
    readonly retryAfterSeconds: number,
    readonly scope: "ip" | "subject",
  ) {
    super("Too many requests");
    this.name = "RateLimited";
  }

  /** The header to send with the 429. */
  get headers(): { "Retry-After": string } {
    return { "Retry-After": String(this.retryAfterSeconds) };
  }
}
