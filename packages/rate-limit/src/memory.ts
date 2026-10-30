import { addSeconds, differenceInMilliseconds, isAfter } from "@krizaka/time";

import type { BucketHit, LimitStore } from "./port";

/** The memory bound of the in-process store, not a business parameter. */
// @fixed: bounds the memory a flood of distinct keys can take
export const DEFAULT_MAX_KEYS = 10_000;
const OVERFLOW = "overflow";

/**
 * Counters kept in this process: fine for one instance, and for tests; a second instance needs `dbLimitStore`. Behaves like the copies
 * Yomizaka and Akinaza carried: when `maxKeys` live windows are held, the ended ones are dropped first, and if it is still
 * full a new key shares ONE overflow window instead, so a flood of keys limits itself and never hands a blocked caller a fresh count.
 * @param options `maxKeys`: the most windows held
 */
export function memoryLimitStore(options: { maxKeys?: number } = {}): LimitStore {
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const windows = new Map<string, BucketHit>();
  const live = (entry: BucketHit | undefined, now: Date): entry is BucketHit => !!entry && isAfter(entry.resetAt, now);

  function prune(now: Date): number {
    let dropped = 0;
    for (const [key, entry] of windows) {
      if (!live(entry, now)) {
        windows.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  return {
    async hit(key, windowSeconds, now) {
      let slot = key;
      let entry = windows.get(slot);
      if (!live(entry, now)) {
        if (windows.size >= maxKeys) prune(now);
        slot = windows.size >= maxKeys ? OVERFLOW : key;
        entry = windows.get(slot);
        if (!live(entry, now)) {
          entry = { count: 0, resetAt: addSeconds(now, windowSeconds) };
          windows.set(slot, entry);
        }
      }
      entry.count += 1;
      return { count: entry.count, resetAt: entry.resetAt };
    },
    async peek(key, now) {
      const entry = windows.get(key);
      return live(entry, now) ? { ...entry } : null;
    },
    async set(key, count, seconds, now) {
      if (!windows.has(key) && windows.size >= maxKeys) prune(now);
      windows.set(key, { count, resetAt: addSeconds(now, seconds) });
    },
    async reset(key) {
      windows.delete(key);
    },
    async purge(now) {
      return prune(now);
    },
  };
}

/** How long until a window ends, in whole seconds, at least one: the `Retry-After` of a refusal. */
export function retryAfterSeconds(resetAt: Date, now: Date): number {
  return Math.max(1, Math.ceil(differenceInMilliseconds(resetAt, now) / 1000));
}
