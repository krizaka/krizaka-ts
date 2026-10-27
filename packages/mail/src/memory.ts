import type { DeliveryRecord, MailStore, SuppressionReason } from "./port";

/** An in-memory store, for unit tests and demos: the behaviour of the database's (the contract kit runs on both). */
export function memoryMailStore(): MailStore {
  const log: (DeliveryRecord & { when: Date })[] = [];
  const suppressed = new Map<string, SuppressionReason>();
  const keys = new Map<string, Date>();
  let seq = 0;
  return {
    async record({ at, ...entry }) {
      seq += 1;
      log.push({ ...entry, id: seq, at: at.toISOString(), when: at });
    },
    async recent(limit) {
      return log.slice(-limit).reverse().map(({ when: _when, ...row }) => row);
    },
    async isSuppressed(hash) {
      return suppressed.has(hash);
    },
    async suppress(hash, reason) {
      if (suppressed.has(hash)) return false;
      suppressed.set(hash, reason);
      return true;
    },
    async unsuppress(hash) {
      return suppressed.delete(hash);
    },
    async hasKey(key) {
      return keys.has(key);
    },
    async claimKey(key, now) {
      if (keys.has(key)) return false;
      keys.set(key, now);
      return true;
    },
    async releaseKey(key) {
      keys.delete(key);
    },
    async purgeBefore(before) {
      let n = 0;
      for (let i = log.length - 1; i >= 0; i -= 1) {
        if (log[i]!.when >= before) continue;
        log.splice(i, 1);
        n += 1;
      }
      for (const [key, at] of keys) {
        if (at >= before) continue;
        keys.delete(key);
        n += 1;
      }
      return n;
    },
  };
}
