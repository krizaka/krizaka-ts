import type { Clock } from "@krizaka/db";

import { retryAfterSeconds } from "./memory";
import {
  type ActionLimit,
  type CheckResult,
  type LimitKeys,
  type LimitsSource,
  type LimitStore,
  RATE_LIMIT_CODE,
  RateLimited,
} from "./port";

export interface LimiterDeps {
  store: LimitStore;
  clock: Clock;
  /** The limits by action: a table, or a function reading the admin's settings at each check (see `@krizaka/rate-limit/settings`). */
  limits: LimitsSource;
  /**
   * What a store that fails does: `true` (the default) lets the request through, so a limiter outage never takes the site down;
   * `false` refuses it by rethrowing. Either way `onStoreError` hears of it.
   */
  failOpen?: boolean;
  /** Told of every store failure (log it). */
  onStoreError?: (error: unknown, action: string) => void;
}

export interface Limiter {
  /** Counts one hit for the action on the address and the subject, address first; the first limit exceeded refuses. */
  check(action: string, keys: LimitKeys): Promise<CheckResult>;
  /** `check`, throwing `RateLimited` (429 with `Retry-After`) on a refusal: the shape of the copies' `limit(…)`. */
  enforce(action: string, keys: LimitKeys): Promise<void>;
  /** Forgets the action's counters of these keys: a successful sign-in clears its failures. */
  forget(action: string, keys: LimitKeys): Promise<void>;
}

const ipKey = (action: string, ip: string | null | undefined) => `${action}:ip:${ip ?? "unknown"}`;
const subjectKey = (action: string, subject: string) => `${action}:s:${subject.toLowerCase()}`;

function checked(action: string, limit: ActionLimit | undefined): ActionLimit {
  if (!limit) throw new RangeError(`${RATE_LIMIT_CODE.noLimits}: no limits declared for the action « ${action} »`);
  const whole = (value: number | undefined) => value === undefined || (Number.isInteger(value) && value >= 1);
  if (
    !Number.isInteger(limit.windowSeconds) ||
    limit.windowSeconds < 1 ||
    !whole(limit.perIp) ||
    !whole(limit.perSubject)
  ) {
    throw new RangeError(
      `${RATE_LIMIT_CODE.badLimit}: « ${action} » needs whole numbers from 1 (windowSeconds ${limit.windowSeconds}, perIp ${limit.perIp}, perSubject ${limit.perSubject})`,
    );
  }
  return limit;
}

/**
 * The limiter of a product: fixed windows per address and per subject for each action, the limits from a table or from settings.
 * The semantics are the copies' (`limit(action, req, subject, perIp, perSubject)`): a window starts at its first hit; a refused hit is
 * counted too; the subject is only counted when a subject is given and the action limits it.
 * @throws RangeError when an action has no limits, or limits that are not whole numbers from 1
 */
export function createLimiter(deps: LimiterDeps): Limiter {
  const limitsOf = async (action: string): Promise<ActionLimit> =>
    checked(action, typeof deps.limits === "function" ? await deps.limits(action) : deps.limits[action]);

  async function guarded<T>(action: string, work: () => Promise<T>, whenFailed: T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      deps.onStoreError?.(error, action);
      if (deps.failOpen === false) throw error;
      return whenFailed;
    }
  }

  async function check(action: string, keys: LimitKeys): Promise<CheckResult> {
    const limit = await limitsOf(action);
    const now = deps.clock.now();
    const counters: { scope: "ip" | "subject"; key: string; max: number }[] = [];
    if (limit.perIp !== undefined) counters.push({ scope: "ip", key: ipKey(action, keys.ip), max: limit.perIp });
    if (limit.perSubject !== undefined && keys.subject)
      counters.push({ scope: "subject", key: subjectKey(action, keys.subject), max: limit.perSubject });
    for (const { scope, key, max } of counters) {
      const hit = await guarded(action, () => deps.store.hit(key, limit.windowSeconds, now), null);
      if (hit && hit.count > max) return { ok: false, retryAfterSeconds: retryAfterSeconds(hit.resetAt, now), scope };
    }
    return { ok: true };
  }

  return {
    check,
    async enforce(action, keys) {
      const result = await check(action, keys);
      if (!result.ok) throw new RateLimited(result.retryAfterSeconds, result.scope);
    },
    async forget(action, keys) {
      const keysToForget = [ipKey(action, keys.ip), ...(keys.subject ? [subjectKey(action, keys.subject)] : [])];
      for (const key of keysToForget) await guarded(action, () => deps.store.reset(key), undefined);
    },
  };
}
