import { ident, type Query } from "@krizaka/db";
import { addSeconds } from "@krizaka/time";

import type { BucketHit, LimitStore } from "./port";

interface Row {
  count: number;
  reset_at: Date | string;
}
const toHit = (row: Row): BucketHit => ({ count: Number(row.count), resetAt: new Date(row.reset_at) });

/**
 * The counters shared by every instance, in `rate_limit.bucket` (see `rateLimitSchema`; the schema may be renamed by the product).
 * `hit` is ONE atomic statement — `INSERT … ON CONFLICT DO UPDATE … RETURNING` — so the row lock serialises concurrent hits and
 * they are counted exactly; an ended window restarts at 1 in the same statement. Times come from the caller (the injected clock),
 * never from the database's `now()`.
 * @param query the product's query (its pool, or a transaction's client)
 * @param options `schema`: the Postgres schema of the module, default `rate_limit`
 */
export function dbLimitStore(query: Query, options: { schema?: string } = {}): LimitStore {
  const bucket = `${ident(options.schema ?? "rate_limit")}.bucket`;
  return {
    async hit(key, windowSeconds, now) {
      const [row] = await query<Row>(
        `INSERT INTO ${bucket} AS b (key, count, window_start, reset_at) VALUES ($1, 1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           count        = CASE WHEN b.reset_at <= $2 THEN 1 ELSE b.count + 1 END,
           window_start = CASE WHEN b.reset_at <= $2 THEN $2 ELSE b.window_start END,
           reset_at     = CASE WHEN b.reset_at <= $2 THEN $3 ELSE b.reset_at END
         RETURNING count, reset_at`,
        [key, now, addSeconds(now, windowSeconds)],
      );
      return toHit(row!);
    },
    async peek(key, now) {
      const [row] = await query<Row>(`SELECT count, reset_at FROM ${bucket} WHERE key = $1 AND reset_at > $2`, [
        key,
        now,
      ]);
      return row ? toHit(row) : null;
    },
    async set(key, count, seconds, now) {
      await query(
        `INSERT INTO ${bucket} (key, count, window_start, reset_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, reset_at = excluded.reset_at`,
        [key, count, now, addSeconds(now, seconds)],
      );
    },
    async reset(key) {
      await query(`DELETE FROM ${bucket} WHERE key = $1`, [key]);
    },
    async purge(now) {
      const rows = await query(`DELETE FROM ${bucket} WHERE reset_at <= $1 RETURNING 1`, [now]);
      return rows.length;
    },
  };
}
