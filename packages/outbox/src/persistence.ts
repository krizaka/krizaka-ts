import { ident, type Query } from "@krizaka/db";
import { addSeconds } from "@krizaka/time";

import { FAIL_STATE, type FailOutcome, type OutboxMessage, type OutboxStats, type OutboxStore } from "./port";

interface Claimed {
  id: string;
  topic: string;
  event_type: string;
  payload: unknown;
  created_at: Date | string;
  attempts: number;
}

/**
 * The PostgreSQL store of the outbox, in `outbox.message` (see `outboxSchema`), over the `Query` it is given: the caller's
 * transaction for `append` (so the message commits or rolls back with the work), a pool for the worker's calls.
 *
 * `claim` is `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`: two workers never lease the same message while a lease is
 * valid. `complete` and `fail` only act for the lease's owner, so a worker that lost its lease cannot overwrite the new holder's outcome.
 * Times come from the caller (the injected clock), never from the database's `now()`.
 * @param schema the Postgres schema of the module, default `outbox`
 */
export function dbOutboxStore(query: Query, schema = "outbox"): OutboxStore {
  const message = `${ident(schema)}.message`;
  return {
    async append(m) {
      const rows = await query(
        `INSERT INTO ${message} (id, topic, event_type, payload, created_at, available_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (id) DO NOTHING RETURNING 1`,
        [m.id, m.topic, m.type, JSON.stringify(m.payload), m.createdAt, m.availableAt],
      );
      return rows.length > 0;
    },
    async claim({ topic, owner, limit, leaseSeconds, maxAttempts, now }) {
      // a message whose last allowed attempt's lease expired with no answer is dead, not delivered a ninth time
      await query(
        `UPDATE ${message} SET dead_at = $1, leased_until = NULL, lease_owner = NULL, last_error = COALESCE(last_error, 'the last attempt''s lease expired with no answer')
          WHERE delivered_at IS NULL AND dead_at IS NULL AND attempts >= $2 AND leased_until IS NOT NULL AND leased_until <= $1`,
        [now, maxAttempts],
      );
      const rows = await query<Claimed>(
        `UPDATE ${message} AS m SET leased_until = $1, lease_owner = $2, attempts = m.attempts + 1
          WHERE m.id IN (
            SELECT id FROM ${message}
             WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at <= $3 AND attempts < $4
               AND (leased_until IS NULL OR leased_until <= $3) AND ($5::text IS NULL OR topic = $5)
             ORDER BY available_at, created_at LIMIT $6
               FOR UPDATE SKIP LOCKED)
        RETURNING m.id, m.topic, m.event_type, m.payload, m.created_at, m.attempts`,
        [addSeconds(now, leaseSeconds), owner, now, maxAttempts, topic ?? null, limit],
      );
      return rows
        .map((r): OutboxMessage => ({
          id: r.id,
          topic: r.topic,
          type: r.event_type,
          payload: r.payload,
          occurredAt: new Date(r.created_at),
          attempts: Number(r.attempts),
        }))
        .sort((a, b) => a.occurredAt.valueOf() - b.occurredAt.valueOf());
    },
    async complete(id, owner, now) {
      const rows = await query(
        `UPDATE ${message} SET delivered_at = $3, leased_until = NULL, lease_owner = NULL
          WHERE id = $1 AND lease_owner = $2 AND delivered_at IS NULL AND dead_at IS NULL RETURNING 1`,
        [id, owner, now],
      );
      return rows.length > 0;
    },
    async fail(id, owner, error, { now, maxAttempts, backoffSeconds, backoffMaxSeconds }): Promise<FailOutcome> {
      const [row] = await query<{ attempts: number; dead_at: Date | null; available_at: Date | string }>(
        `UPDATE ${message} SET last_error = $3::text, leased_until = NULL, lease_owner = NULL,
                dead_at      = CASE WHEN attempts >= $5 THEN $4::timestamptz ELSE NULL END,
                available_at = CASE WHEN attempts >= $5 THEN available_at
                                    ELSE $4::timestamptz + make_interval(secs => LEAST($7::double precision, $6::double precision * power(2, attempts - 1))) END
          WHERE id = $1 AND lease_owner = $2 AND delivered_at IS NULL AND dead_at IS NULL
        RETURNING attempts, dead_at, available_at`,
        [id, owner, error, now, maxAttempts, backoffSeconds, backoffMaxSeconds],
      );
      if (!row) return { state: FAIL_STATE.lost };
      return row.dead_at
        ? { state: FAIL_STATE.dead }
        : { state: FAIL_STATE.retry, availableAt: new Date(row.available_at) };
    },
    async retryDead(id, now) {
      const rows = await query(
        `UPDATE ${message} SET dead_at = NULL, attempts = 0, available_at = $2 WHERE id = $1 AND dead_at IS NOT NULL RETURNING 1`,
        [id, now],
      );
      return rows.length > 0;
    },
    async purgeBefore(before) {
      const rows = await query(`DELETE FROM ${message} WHERE COALESCE(delivered_at, dead_at) < $1 RETURNING 1`, [
        before,
      ]);
      return rows.length;
    },
    async stats(now): Promise<OutboxStats> {
      const [row] = await query<{ pending: number; leased: number; delivered: number; dead: number }>(
        `SELECT count(*) FILTER (WHERE delivered_at IS NULL AND dead_at IS NULL AND (leased_until IS NULL OR leased_until <= $1))::int AS pending,
                count(*) FILTER (WHERE delivered_at IS NULL AND dead_at IS NULL AND leased_until > $1)::int AS leased,
                count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
                count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead
           FROM ${message}`,
        [now],
      );
      return {
        pending: row?.pending ?? 0,
        leased: row?.leased ?? 0,
        delivered: row?.delivered ?? 0,
        dead: row?.dead ?? 0,
      };
    },
  };
}
