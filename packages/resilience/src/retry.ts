import { differenceInMilliseconds } from "@krizaka/time";

import type { Clock } from "./circuit";

export type Sleep = (milliseconds: number) => Promise<void>;

export const systemSleep: Sleep = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export interface RetryBudgetOptions {
  /** Tokens the bucket holds (and starts with): the burst of retries allowed. */
  capacity: number;
  /** Tokens given back per second. */
  refillPerSecond: number;
}

/**
 * A token bucket shared by the calls of one client: a retry costs a token, so a dependency that is down gets a bounded
 * extra load instead of attempts × callers.
 */
export function createRetryBudget(options: RetryBudgetOptions, clock: Clock) {
  let tokens = options.capacity;
  let last = clock.now();
  return {
    /** Takes a token for one retry; false when the bucket is empty. */
    tryTake(): boolean {
      const now = clock.now();
      tokens = Math.min(
        options.capacity,
        tokens + (differenceInMilliseconds(now, last) / 1000) * options.refillPerSecond,
      );
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

export type RetryBudget = ReturnType<typeof createRetryBudget>;

export interface RetryOptions {
  /** Attempts in all, the first included (default 3). */
  maxAttempts?: number;
  /** Backoff base in ms (default 100): the ceiling of the first wait. */
  baseMs?: number;
  /** Backoff cap in ms (default 10 000). */
  capMs?: number;
  /** What is safe to try again (a network error, a 503, a 429 — never a refusal, never a non-idempotent write). */
  isRetryable: (error: unknown, attempt: number) => boolean;
  /** The server's `Retry-After` in ms, if the error carries one: the wait is at least this (RFC 9110 § 10.2.3). */
  retryAfterMs?: (error: unknown) => number | undefined;
  budget?: RetryBudget;
  /** In [0, 1): `Math.random` by default; tests give theirs. */
  random?: () => number;
  sleep?: Sleep;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 100;
const DEFAULT_CAP_MS = 10_000;

/** Full jitter (AWS): a wait uniform in [0, min(cap, base × 2^(attempt-1))]. `attempt` counts from 1. */
export function backoffMs(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** (attempt - 1)));
}

/**
 * `Retry-After` as milliseconds: delay-seconds or an HTTP-date (against `clock`); undefined when absent or not valid.
 * Negative or past dates are 0.
 */
export function parseRetryAfter(value: string | null | undefined, clock: Clock): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, differenceInMilliseconds(at, clock.now()));
}

/**
 * Runs `operation`; on a failure `isRetryable` accepts, waits (full-jitter backoff, at least `Retry-After`) and tries again,
 * while attempts and the retry budget last. The last error is rethrown as it was; a non-retryable one at once.
 */
export async function retrying<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const capMs = options.capMs ?? DEFAULT_CAP_MS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? systemSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !options.isRetryable(error, attempt)) throw error;
      if (options.budget && !options.budget.tryTake()) throw error;
      const asked = options.retryAfterMs?.(error) ?? 0;
      await sleep(Math.max(backoffMs(attempt, baseMs, capMs, random), asked));
    }
  }
}
