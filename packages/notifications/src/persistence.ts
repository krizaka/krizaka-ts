import { ident, type Query } from "@krizaka/db";

import type { Channel, Device, Item, NotificationStore, Platform } from "./port";

interface ItemRow {
  id: string;
  account_id: string;
  category: string;
  template: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  in_bell: boolean;
  created_at: Date;
  read_at: Date | null;
}
interface DeviceRow {
  id: string;
  account_id: string;
  platform: Platform;
  token: string;
  created_at: Date;
  last_seen_at: Date;
}

const toItem = (r: ItemRow): Item => ({ id: r.id, accountId: r.account_id, category: r.category, template: r.template, payload: r.payload, dedupeKey: r.dedupe_key, inBell: r.in_bell, createdAt: r.created_at, readAt: r.read_at });
const toDevice = (r: DeviceRow): Device => ({ id: r.id, accountId: r.account_id, platform: r.platform, token: r.token, createdAt: r.created_at, lastSeenAt: r.last_seen_at });

/**
 * The PostgreSQL store of « notifications » over a `Query`, in schema `notifications` (or the one the product renamed it to).
 * `record` takes a transaction-level advisory lock per account and category, so the burst cap holds under concurrency ONLY inside the
 * caller's transaction: pass `tx`.
 */
export function dbNotificationStore(query: Query, schema = "notifications"): NotificationStore {
  const s = ident(schema);
  return {
    async record(item, burst) {
      await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${s}:${item.accountId}:${item.category}`]);
      const [seen] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${s}.item WHERE account_id = $1 AND category = $2 AND created_at >= $3`, [item.accountId, item.category, burst.since]);
      const inserted = await query(
        `INSERT INTO ${s}.item (id, account_id, category, template, payload, dedupe_key, in_bell, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING 1`,
        [item.id, item.accountId, item.category, item.template, JSON.stringify(item.payload), item.dedupeKey, item.inBell, item.createdAt],
      );
      return inserted.length === 0 ? { duplicate: true, capped: false } : { duplicate: false, capped: (seen?.n ?? 0) >= burst.max };
    },
    async preferences(accountId) {
      return query<{ category: string; channel: Channel; enabled: boolean }>(`SELECT category, channel, enabled FROM ${s}.preference WHERE account_id = $1`, [accountId]);
    },
    async setPreference(accountId, category, channel, enabled, now) {
      await query(`INSERT INTO ${s}.preference (account_id, category, channel, enabled, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id, category, channel) DO UPDATE SET enabled = $4, updated_at = $5`, [accountId, category, channel, enabled, now]);
    },
    async list(accountId, { unreadOnly, limit, before }) {
      const rows = await query<ItemRow>(
        `SELECT * FROM ${s}.item WHERE account_id = $1 AND in_bell AND ($2::boolean = false OR read_at IS NULL)
           AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $5`,
        [accountId, unreadOnly, before?.createdAt ?? null, before?.id ?? null, limit],
      );
      return rows.map(toItem);
    },
    async unreadCount(accountId) {
      const [row] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${s}.item WHERE account_id = $1 AND in_bell AND read_at IS NULL`, [accountId]);
      return row?.n ?? 0;
    },
    async markRead(accountId, ids, now) {
      const rows = await query(`UPDATE ${s}.item SET read_at = $3 WHERE account_id = $1 AND in_bell AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) RETURNING 1`, [accountId, ids ? [...ids] : null, now]);
      return rows.length;
    },
    async upsertDevice(d) {
      await query(
        `INSERT INTO ${s}.device (id, account_id, platform, token, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (token) DO UPDATE SET account_id = $2, platform = $3, last_seen_at = $6, revoked_at = NULL`,
        [d.id, d.accountId, d.platform, d.token, d.createdAt, d.lastSeenAt],
      );
    },
    async devices(accountId) {
      return (await query<DeviceRow>(`SELECT id, account_id, platform, token, created_at, last_seen_at FROM ${s}.device WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at, id`, [accountId])).map(toDevice);
    },
    async revokeDevice(token, now) {
      return (await query(`UPDATE ${s}.device SET revoked_at = $2 WHERE token = $1 AND revoked_at IS NULL RETURNING 1`, [token, now])).length > 0;
    },
    async purgeBefore(before) {
      return (await query(`DELETE FROM ${s}.item WHERE created_at < $1 RETURNING 1`, [before])).length;
    },
    async erase(accountId) {
      const items = await query(`DELETE FROM ${s}.item WHERE account_id = $1 RETURNING 1`, [accountId]);
      const prefs = await query(`DELETE FROM ${s}.preference WHERE account_id = $1 RETURNING 1`, [accountId]);
      const devs = await query(`DELETE FROM ${s}.device WHERE account_id = $1 RETURNING 1`, [accountId]);
      return items.length + prefs.length + devs.length;
    },
  };
}
