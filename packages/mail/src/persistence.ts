import { ident, type Query } from "@krizaka/db";

import type { DeliveryRecord, MailStore, SuppressionReason } from "./port";

interface Row {
  id: string;
  at: Date;
  template: string;
  category: string;
  locale: string;
  to_hash: string;
  status: DeliveryRecord["status"];
  message_id: string | null;
  idempotency_key: string | null;
  detail: string | null;
}

/**
 * The PostgreSQL store of « mail » over a `Query`, in schema `mail` (or the one the product renamed it to).
 * @param query a pool-level query
 * @param schema the Postgres schema, default `mail`
 */
export function dbMailStore(query: Query, schema = "mail"): MailStore {
  const s = ident(schema);
  return {
    async record(e) {
      await query(`INSERT INTO ${s}.delivery (at, template, category, locale, to_hash, status, message_id, idempotency_key, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [e.at, e.template, e.category, e.locale, e.to, e.status, e.messageId ?? null, e.idempotencyKey ?? null, e.detail ?? null]);
    },
    async recent(limit) {
      const rows = await query<Row>(`SELECT * FROM ${s}.delivery ORDER BY id DESC LIMIT $1`, [limit]);
      return rows.map((r) => ({ id: Number(r.id), at: r.at.toISOString(), template: r.template, category: r.category, locale: r.locale, to: r.to_hash, status: r.status, messageId: r.message_id ?? undefined, idempotencyKey: r.idempotency_key ?? undefined, detail: r.detail ?? undefined }));
    },
    async isSuppressed(hash) {
      return (await query(`SELECT 1 FROM ${s}.suppression WHERE address_hash = $1`, [hash])).length > 0;
    },
    async suppress(hash, reason: SuppressionReason, now) {
      return (await query(`INSERT INTO ${s}.suppression (address_hash, reason, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`, [hash, reason, now])).length > 0;
    },
    async unsuppress(hash) {
      return (await query(`DELETE FROM ${s}.suppression WHERE address_hash = $1 RETURNING 1`, [hash])).length > 0;
    },
    async hasKey(key) {
      return (await query(`SELECT 1 FROM ${s}.idempotency WHERE key = $1`, [key])).length > 0;
    },
    async claimKey(key, now) {
      return (await query(`INSERT INTO ${s}.idempotency (key, created_at) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [key, now])).length > 0;
    },
    async releaseKey(key) {
      await query(`DELETE FROM ${s}.idempotency WHERE key = $1`, [key]);
    },
    async purgeBefore(before) {
      const logs = await query(`DELETE FROM ${s}.delivery WHERE at < $1 RETURNING 1`, [before]);
      const keys = await query(`DELETE FROM ${s}.idempotency WHERE created_at < $1 RETURNING 1`, [before]);
      return logs.length + keys.length;
    },
  };
}
