import type { Query } from "@krizaka/db";

import type { AuditEntry, AuditFilters, AuditStore } from "./port";
import { PAGE } from "./rules";

interface Row {
  id: string;
  at: Date;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
}

const COLUMNS = "id::text AS id, at, actor_id, actor_label, action, target_type, target_id, detail, host(ip) AS ip";
const toEntry = (r: Row): AuditEntry => ({ id: r.id, at: r.at, actorId: r.actor_id, actorLabel: r.actor_label, action: r.action, targetType: r.target_type, targetId: r.target_id, detail: r.detail, ip: r.ip });

/** The WHERE clause of the admin's filters, with its parameters ($1, $2… in order). */
function where(filters: AuditFilters): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => { params.push(value); parts.push(clause(params.length)); };
  if (filters.actorId !== undefined) add((n) => `actor_id = $${n}`, filters.actorId);
  if (filters.actionPrefix !== undefined) add((n) => `starts_with(action, $${n})`, filters.actionPrefix);
  if (filters.target !== undefined) { add((n) => `target_type = $${n}`, filters.target.type); add((n) => `target_id = $${n}`, filters.target.id); }
  if (filters.from !== undefined) add((n) => `at >= $${n}`, filters.from);
  if (filters.to !== undefined) add((n) => `at < $${n}`, filters.to);
  if (filters.before !== undefined) add((n) => `id < $${n}::bigint`, filters.before);
  return { sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

/**
 * The PostgreSQL store, on `<schema>.entry` (`auditSchema`), over the product's query: a pool, or an open transaction.
 * @param query the product's SQL runner
 * @param schema the Postgres schema, when the product renamed it (default `audit`)
 * @returns a store that passes `auditStoreContract`
 */
export function dbAuditStore(query: Query, schema = "audit"): AuditStore {
  const table = `${schema}.entry`;
  const rows = async (sql: string, params?: unknown[]) => (await query<Row>(sql, params)).map(toEntry);
  return {
    async insert(e) {
      await query(`INSERT INTO ${table} (at, actor_id, actor_label, action, target_type, target_id, detail, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [e.at, e.actorId, e.actorLabel, e.action, e.targetType, e.targetId, JSON.stringify(e.detail), e.ip]);
    },
    async list(filters) {
      const { sql, params } = where(filters);
      return rows(`SELECT ${COLUMNS} FROM ${table} ${sql} ORDER BY id DESC LIMIT ${Math.min(filters.limit ?? PAGE.default, PAGE.max)}`, params);
    },
    forActor: (actorId) => rows(`SELECT ${COLUMNS} FROM ${table} WHERE actor_id = $1 ORDER BY id DESC`, [actorId]),
    async redactActor(actorId) {
      return (await query(`UPDATE ${table} SET actor_id = NULL, actor_label = 'erased', ip = NULL WHERE actor_id = $1 RETURNING id`, [actorId])).length;
    },
    async purgeBefore(before) {
      return (await query(`DELETE FROM ${table} WHERE at < $1 RETURNING id`, [before])).length;
    },
  };
}
