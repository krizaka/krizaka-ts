import { ident, type Query } from "@krizaka/db";

import { type Calendar, type CreditStore, type Entry, type Grant, type GrantState, type Hold } from "./port";

interface GrantRow {
  id: string;
  account_id: string;
  bucket: Grant["bucket"];
  amount: string | number;
  cap_per_day: string | number | null;
  cap_per_month: string | number | null;
  expires_at: Date | string | null;
  on_exhausted: Grant["onExhausted"];
  source: string;
  created_at: Date | string;
}
interface StateRow extends GrantRow {
  remaining: string | number;
  used_today: string | number;
  used_month: string | number;
  closed: boolean;
}
interface EntryRow {
  id: string;
  account_id: string;
  grant_id: string | null;
  type: Entry["type"];
  amount: string | number;
  reason: string;
  operation: string;
  idempotency_key: string;
  reverses: string | null;
  hold_id: string | null;
  at: Date | string;
}
interface HoldRow {
  id: string;
  account_id: string;
  amount: string | number;
  expires_at: Date | string;
  status: Hold["status"];
  settled_amount: string | number | null;
  created_at: Date | string;
  closed_at: Date | string | null;
  operation: string;
}

const num = (v: string | number): number => Number(v);
const numOrNull = (v: string | number | null): number | null => (v === null ? null : Number(v));
const date = (v: Date | string): Date => new Date(v);
const dateOrNull = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

const toGrant = (r: GrantRow): Grant => ({
  id: r.id,
  accountId: r.account_id,
  bucket: r.bucket,
  amount: num(r.amount),
  capPerDay: numOrNull(r.cap_per_day),
  capPerMonth: numOrNull(r.cap_per_month),
  expiresAt: dateOrNull(r.expires_at),
  onExhausted: r.on_exhausted,
  source: r.source,
  createdAt: date(r.created_at),
});
const toEntry = (r: EntryRow): Entry => ({
  id: r.id,
  accountId: r.account_id,
  grantId: r.grant_id,
  type: r.type,
  amount: num(r.amount),
  reason: r.reason,
  operation: r.operation,
  idempotencyKey: r.idempotency_key,
  reverses: r.reverses,
  holdId: r.hold_id,
  at: date(r.at),
});
const toHold = (r: HoldRow): Hold => ({
  id: r.id,
  accountId: r.account_id,
  amount: num(r.amount),
  expiresAt: date(r.expires_at),
  status: r.status,
  settledAmount: numOrNull(r.settled_amount),
  createdAt: date(r.created_at),
  closedAt: dateOrNull(r.closed_at),
  operation: r.operation,
});

/**
 * The PostgreSQL store of the ledger, in schema `credits` (see `creditsSchema`), over the `Query` it is given: the caller's transaction
 * for every writing call, so the lines commit or roll back with the product's work. `lock` is `pg_advisory_xact_lock` on the account:
 * two requests spending the last credit take turns, and the second sees the first's lines. Days and months are cut in the calendar's
 * IANA zone BY POSTGRES (`AT TIME ZONE`), so daylight-saving shifts are the database's own tz data. Times come from the caller.
 * @param schema the Postgres schema of the module, default `credits`
 */
export function dbCreditStore(query: Query, schema = "credits"): CreditStore {
  const s = ident(schema);
  const grant = `${s}."grant"`;
  const entry = `${s}.entry`;
  const hold = `${s}.hold`;
  return {
    async lock(accountId) {
      await query("SELECT pg_advisory_xact_lock(hashtextextended('krizaka.credits:' || $1::text, 0))", [accountId]);
    },
    async insertGrant(g) {
      await query(
        `INSERT INTO ${grant} (id, account_id, bucket, amount, cap_per_day, cap_per_month, expires_at, on_exhausted, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          g.id,
          g.accountId,
          g.bucket,
          g.amount,
          g.capPerDay,
          g.capPerMonth,
          g.expiresAt,
          g.onExhausted,
          g.source,
          g.createdAt,
        ],
      );
    },
    async grantById(id) {
      const [row] = await query<GrantRow>(`SELECT * FROM ${grant} WHERE id = $1`, [id]);
      return row ? toGrant(row) : null;
    },
    async grantStates(accountId, calendar: Calendar): Promise<GrantState[]> {
      const rows = await query<StateRow>(
        `SELECT g.*,
                COALESCE(SUM(e.amount), 0) AS remaining,
                COALESCE(-SUM(e.amount) FILTER (WHERE e.type IN ('DEBIT', 'REFUND') AND (e.at AT TIME ZONE $2)::date = $3::date), 0) AS used_today,
                COALESCE(-SUM(e.amount) FILTER (WHERE e.type IN ('DEBIT', 'REFUND') AND to_char(e.at AT TIME ZONE $2, 'YYYY-MM') = $4), 0) AS used_month,
                COALESCE(bool_or(e.type = 'EXPIRY'), false) AS closed
           FROM ${grant} g LEFT JOIN ${entry} e ON e.grant_id = g.id
          WHERE g.account_id = $1
          GROUP BY g.id`,
        [accountId, calendar.timeZone, calendar.day, calendar.month],
      );
      return rows.map((r) => ({
        grant: toGrant(r),
        remaining: num(r.remaining),
        usedToday: num(r.used_today),
        usedThisMonth: num(r.used_month),
        closed: r.closed,
      }));
    },
    async insertEntries(entries) {
      for (const e of entries) {
        await query(
          `INSERT INTO ${entry} (id, account_id, grant_id, type, amount, reason, operation, idempotency_key, reverses, hold_id, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            e.id,
            e.accountId,
            e.grantId,
            e.type,
            e.amount,
            e.reason,
            e.operation,
            e.idempotencyKey,
            e.reverses,
            e.holdId,
            e.at,
          ],
        );
      }
    },
    async entriesOf(operation) {
      return (await query<EntryRow>(`SELECT * FROM ${entry} WHERE operation = $1 ORDER BY seq`, [operation])).map(
        toEntry,
      );
    },
    async history(accountId, { limit, before }) {
      return (
        await query<EntryRow>(
          `SELECT * FROM ${entry} WHERE account_id = $1 AND ($2::timestamptz IS NULL OR at < $2) ORDER BY seq DESC LIMIT $3`,
          [accountId, before ?? null, limit],
        )
      ).map(toEntry);
    },
    async insertHold(h) {
      await query(
        `INSERT INTO ${hold} (id, account_id, amount, expires_at, status, settled_amount, created_at, closed_at, operation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [h.id, h.accountId, h.amount, h.expiresAt, h.status, h.settledAmount, h.createdAt, h.closedAt, h.operation],
      );
    },
    async holdById(id) {
      const [row] = await query<HoldRow>(`SELECT * FROM ${hold} WHERE id = $1`, [id]);
      return row ? toHold(row) : null;
    },
    async holdByOperation(operation) {
      const [row] = await query<HoldRow>(`SELECT * FROM ${hold} WHERE operation = $1`, [operation]);
      return row ? toHold(row) : null;
    },
    async heldAmount(accountId, now, exceptHoldId) {
      const [row] = await query<{ held: string | number }>(
        `SELECT COALESCE(SUM(amount), 0) AS held FROM ${hold} WHERE account_id = $1 AND status = 'active' AND expires_at > $2 AND ($3::uuid IS NULL OR id <> $3)`,
        [accountId, now, exceptHoldId ?? null],
      );
      return num(row?.held ?? 0);
    },
    async closeHold(id, status, settledAmount, at) {
      await query(`UPDATE ${hold} SET status = $2, settled_amount = $3, closed_at = $4 WHERE id = $1`, [
        id,
        status,
        settledAmount,
        at,
      ]);
    },
    async lapsedWithCredits(now, limit) {
      const rows = await query<{ id: string; account_id: string }>(
        `SELECT g.id, g.account_id FROM ${grant} g JOIN ${entry} e ON e.grant_id = g.id
          WHERE g.bucket = 'granted' AND g.expires_at <= $1
          GROUP BY g.id HAVING SUM(e.amount) > 0 AND NOT bool_or(e.type = 'EXPIRY')
          ORDER BY g.expires_at, g.id LIMIT $2`,
        [now, limit],
      );
      return rows.map((r) => ({ grantId: r.id, accountId: r.account_id }));
    },
  };
}
