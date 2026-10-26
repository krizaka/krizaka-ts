import { addSeconds, isAfter, isBefore } from "@krizaka/time";

import { FAIL_STATE, type FailOutcome, type OutboxMessage, type OutboxStats, type OutboxStore } from "./port";
import { backoffSeconds } from "./rules";

interface Row {
  id: string;
  topic: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  availableAt: Date;
  attempts: number;
  leasedUntil: Date | null;
  leaseOwner: string | null;
  deliveredAt: Date | null;
  deadAt: Date | null;
  lastError: string | null;
}

/** An in-memory outbox store, for unit tests and demos (the same behaviour as the database's: the contract kit runs on both). */
export function memoryOutboxStore(): OutboxStore & { rows(): readonly Readonly<Row>[] } {
  const rows = new Map<string, Row>();
  const open = (r: Row) => r.deliveredAt === null && r.deadAt === null;
  const leaseValid = (r: Row, now: Date) => r.leasedUntil !== null && isAfter(r.leasedUntil, now);
  return {
    async append(m) {
      if (rows.has(m.id)) return false;
      rows.set(m.id, { id: m.id, topic: m.topic, type: m.type, payload: structuredClone(m.payload), createdAt: m.createdAt, availableAt: m.availableAt, attempts: 0, leasedUntil: null, leaseOwner: null, deliveredAt: null, deadAt: null, lastError: null });
      return true;
    },
    async claim({ topic, owner, limit, leaseSeconds, maxAttempts, now }) {
      for (const r of rows.values()) {
        if (open(r) && r.attempts >= maxAttempts && r.leasedUntil !== null && !leaseValid(r, now)) {
          r.deadAt = now;
          r.leasedUntil = null;
          r.leaseOwner = null;
          r.lastError ??= "the last attempt's lease expired with no answer";
        }
      }
      const due = [...rows.values()]
        .filter((r) => open(r) && r.attempts < maxAttempts && !isAfter(r.availableAt, now) && !leaseValid(r, now) && (topic === undefined || r.topic === topic))
        .sort((a, b) => a.availableAt.valueOf() - b.availableAt.valueOf() || a.createdAt.valueOf() - b.createdAt.valueOf())
        .slice(0, limit);
      return due.map((r): OutboxMessage => {
        r.attempts += 1;
        r.leasedUntil = addSeconds(now, leaseSeconds);
        r.leaseOwner = owner;
        return { id: r.id, topic: r.topic, type: r.type, payload: structuredClone(r.payload), occurredAt: r.createdAt, attempts: r.attempts };
      });
    },
    async complete(id, owner, now) {
      const r = rows.get(id);
      if (!r || !open(r) || r.leaseOwner !== owner) return false;
      r.deliveredAt = now;
      r.leasedUntil = null;
      r.leaseOwner = null;
      return true;
    },
    async fail(id, owner, error, { now, maxAttempts, backoffSeconds: base, backoffMaxSeconds }): Promise<FailOutcome> {
      const r = rows.get(id);
      if (!r || !open(r) || r.leaseOwner !== owner) return { state: FAIL_STATE.lost };
      r.lastError = error;
      r.leasedUntil = null;
      r.leaseOwner = null;
      if (r.attempts >= maxAttempts) {
        r.deadAt = now;
        return { state: FAIL_STATE.dead };
      }
      r.availableAt = addSeconds(now, backoffSeconds(r.attempts, { backoffSeconds: base, backoffMaxSeconds }));
      return { state: FAIL_STATE.retry, availableAt: r.availableAt };
    },
    async retryDead(id, now) {
      const r = rows.get(id);
      if (!r || r.deadAt === null) return false;
      r.deadAt = null;
      r.attempts = 0;
      r.availableAt = now;
      return true;
    },
    async purgeBefore(before) {
      let removed = 0;
      for (const [id, r] of rows) {
        const finished = r.deliveredAt ?? r.deadAt;
        if (finished !== null && isBefore(finished, before)) {
          rows.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
    async stats(now): Promise<OutboxStats> {
      const all = [...rows.values()];
      return {
        pending: all.filter((r) => open(r) && !leaseValid(r, now)).length,
        leased: all.filter((r) => open(r) && leaseValid(r, now)).length,
        delivered: all.filter((r) => r.deliveredAt !== null).length,
        dead: all.filter((r) => r.deadAt !== null).length,
      };
    },
    rows: () => [...rows.values()],
  };
}
