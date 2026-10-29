import { localDay } from "@krizaka/intl/date";
import { isAfter } from "@krizaka/time";

import { BUCKET, type CreditStore, type Entry, ENTRY_TYPE, type Grant, type Hold, HOLD_STATUS } from "./port";

/**
 * An in-memory ledger, for unit tests and demos: the same behaviour as the database's (the contract kit runs on both) except that
 * `lock` does nothing, because it has no transaction to hold it in. It is for one flow at a time; concurrency is proved on PostgreSQL.
 */
export function memoryCreditStore(): CreditStore & { entries(): readonly Readonly<Entry>[] } {
  const grants = new Map<string, Grant>();
  const entries: Entry[] = [];
  const holds = new Map<string, Hold>();
  return {
    entries: () => entries,
    async lock() {},
    async insertGrant(g) {
      grants.set(g.id, { ...g });
    },
    async grantById(id) {
      const g = grants.get(id);
      return g ? { ...g } : null;
    },
    async grantStates(accountId, calendar) {
      return [...grants.values()]
        .filter((g) => g.accountId === accountId)
        .map((g) => {
          const lines = entries.filter((e) => e.grantId === g.id);
          const used = (match: (e: Entry) => boolean) =>
            -lines
              .filter((e) => (e.type === ENTRY_TYPE.debit || e.type === ENTRY_TYPE.refund) && match(e))
              .reduce((a, e) => a + e.amount, 0);
          return {
            grant: { ...g },
            remaining: lines.reduce((a, e) => a + e.amount, 0),
            usedToday: used((e) => localDay(e.at, calendar.timeZone) === calendar.day),
            usedThisMonth: used((e) => localDay(e.at, calendar.timeZone).slice(0, 7) === calendar.month),
            closed: lines.some((e) => e.type === ENTRY_TYPE.expiry),
          };
        });
    },
    async insertEntries(batch) {
      for (const e of batch) {
        if (entries.some((x) => x.idempotencyKey === e.idempotencyKey))
          throw new Error(`duplicate idempotency key ${e.idempotencyKey}`);
      }
      entries.push(...batch.map((e) => ({ ...e })));
    },
    async entriesOf(operation) {
      return entries.filter((e) => e.operation === operation).map((e) => ({ ...e }));
    },
    async history(accountId, { limit, before }) {
      return entries
        .filter((e) => e.accountId === accountId && (!before || e.at < before))
        .reverse()
        .slice(0, limit)
        .map((e) => ({ ...e }));
    },
    async insertHold(h) {
      holds.set(h.id, { ...h });
    },
    async holdById(id) {
      const h = holds.get(id);
      return h ? { ...h } : null;
    },
    async holdByOperation(operation) {
      const h = [...holds.values()].find((x) => x.operation === operation);
      return h ? { ...h } : null;
    },
    async heldAmount(accountId, now, exceptHoldId) {
      return [...holds.values()]
        .filter(
          (h) =>
            h.accountId === accountId &&
            h.status === HOLD_STATUS.active &&
            isAfter(h.expiresAt, now) &&
            h.id !== exceptHoldId,
        )
        .reduce((a, h) => a + h.amount, 0);
    },
    async closeHold(id, status, settledAmount, at) {
      const h = holds.get(id);
      if (h) Object.assign(h, { status, settledAmount, closedAt: at });
    },
    async lapsedWithCredits(now, limit) {
      return [...grants.values()]
        .filter((g) => g.bucket === BUCKET.granted && g.expiresAt !== null && g.expiresAt <= now)
        .filter((g) => {
          const lines = entries.filter((e) => e.grantId === g.id);
          return lines.reduce((a, e) => a + e.amount, 0) > 0 && !lines.some((e) => e.type === ENTRY_TYPE.expiry);
        })
        .sort((a, b) => a.expiresAt!.valueOf() - b.expiresAt!.valueOf() || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((g) => ({ grantId: g.id, accountId: g.accountId }));
    },
  };
}
