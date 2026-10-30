import type { AuditEntry, AuditFilters, AuditStore } from "./port";
import { pageSize } from "./rules";

/** Whether an entry passes the admin's filters (the same semantics as the database store). */
export function matches(entry: AuditEntry, filters: AuditFilters): boolean {
  return (
    (filters.actorId === undefined || entry.actorId === filters.actorId) &&
    (filters.actionPrefix === undefined || entry.action.startsWith(filters.actionPrefix)) &&
    (filters.target === undefined ||
      (entry.targetType === filters.target.type && entry.targetId === filters.target.id)) &&
    (filters.from === undefined || entry.at >= filters.from) &&
    (filters.to === undefined || entry.at < filters.to) &&
    (filters.before === undefined || BigInt(entry.id) < BigInt(filters.before))
  );
}

/**
 * An in-memory trail, for unit tests and demos. Ids grow like the table's `bigserial`.
 * @returns a store that passes `auditStoreContract`
 */
export function memoryAuditStore(): AuditStore {
  const rows: AuditEntry[] = [];
  let lastId = 0n; // like the table's sequence: never reused, even after a purge
  /** An independent copy: nothing given or read can change the stored trail. */
  const copy = (e: AuditEntry): AuditEntry => structuredClone(e);
  const newestFirst = () => [...rows].sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
  return {
    async insert(entry) {
      lastId += 1n;
      rows.push(copy({ ...entry, id: String(lastId) }));
    },
    async list(filters) {
      return newestFirst()
        .filter((e) => matches(e, filters))
        .slice(0, pageSize(filters.limit))
        .map(copy);
    },
    async forActor(actorId) {
      return newestFirst()
        .filter((e) => e.actorId === actorId)
        .map(copy);
    },
    async redactActor(actorId) {
      const mine = rows.filter((e) => e.actorId === actorId);
      for (const e of mine) Object.assign(e, { actorId: null, actorLabel: "erased", ip: null });
      return mine.length;
    },
    async purgeBefore(before) {
      const old = rows.filter((e) => e.at < before);
      for (const e of old) rows.splice(rows.indexOf(e), 1);
      return old.length;
    },
  };
}
