import { isBefore } from "@krizaka/time";

import type { Challenge, CodeStore } from "./port";

/** The memory bound of the in-process store, not a business parameter. */
// @fixed: bounds the memory a flood of challenges can take
export const DEFAULT_MAX_CHALLENGES = 5_000;

/**
 * Challenges kept in this process: right for one instance and for tests. A person whose request lands on another instance (or after
 * a restart) is simply asked for a new code; a product with several instances gives the port a shared adapter.
 * When full, the oldest challenge is dropped first, so a flood evicts itself and never grows the memory.
 */
export function memoryCodeStore(options: { maxChallenges?: number } = {}): CodeStore {
  const max = options.maxChallenges ?? DEFAULT_MAX_CHALLENGES;
  const rows = new Map<string, Challenge>();
  return {
    put(challenge) {
      if (rows.size >= max && !rows.has(challenge.id)) {
        const oldest = rows.keys().next();
        if (!oldest.done) rows.delete(oldest.value);
      }
      rows.set(challenge.id, { ...challenge });
      return Promise.resolve();
    },
    get(id) {
      const row = rows.get(id);
      return Promise.resolve(row ? { ...row } : null);
    },
    recordFailure(id) {
      const row = rows.get(id);
      if (!row) return Promise.resolve(null);
      row.attempts += 1;
      return Promise.resolve(row.attempts);
    },
    consume(id) {
      return Promise.resolve(rows.delete(id));
    },
    purge(now) {
      let dropped = 0;
      for (const [id, row] of rows) {
        if (isBefore(row.expiresAt, now)) {
          rows.delete(id);
          dropped += 1;
        }
      }
      return Promise.resolve(dropped);
    },
  };
}
