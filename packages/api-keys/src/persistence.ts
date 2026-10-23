import type { Query } from "@krizaka/db";

import type { ApiKeyRecord, ApiKeyStore } from "./port";

export type { Query };

interface Row {
  id: string;
  owner_id: string;
  name: string;
  public_id: string;
  secret_hash: string;
  scopes: string[];
  expires_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  rotated_from_id: string | null;
  superseded_at: Date | null;
}

const toRecord = (r: Row): ApiKeyRecord => ({ id: r.id, ownerId: r.owner_id, name: r.name, publicId: r.public_id, secretHash: r.secret_hash, scopes: r.scopes, expiresAt: r.expires_at, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, rotatedFromId: r.rotated_from_id, supersededAt: r.superseded_at });
const COLUMNS = "id, owner_id, name, public_id, secret_hash, scopes, expires_at, created_at, last_used_at, revoked_at, rotated_from_id, superseded_at";
const COLUMN_OF = { lastUsedAt: "last_used_at", revokedAt: "revoked_at", supersededAt: "superseded_at" } as const;

/** PostgreSQL adapter over the product's `Query` (table `api_keys`, see `apiKeysSchema`). */
export function dbApiKeyStore(run: Query): ApiKeyStore {
  const query = <T = unknown>(sql: string, params?: unknown[]) => run<T>(sql, params);
  return {
    async insert(r) {
      await query(`INSERT INTO api_keys (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [r.id, r.ownerId, r.name, r.publicId, r.secretHash, r.scopes, r.expiresAt, r.createdAt, r.lastUsedAt, r.revokedAt, r.rotatedFromId, r.supersededAt]);
    },
    async get(id) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM api_keys WHERE id = $1`, [id]);
      return row ? toRecord(row) : null;
    },
    async findByPublicId(publicId) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM api_keys WHERE public_id = $1`, [publicId]);
      return row ? toRecord(row) : null;
    },
    async list(ownerId) {
      return (await query<Row>(`SELECT ${COLUMNS} FROM api_keys WHERE owner_id = $1 ORDER BY created_at, id`, [ownerId])).map(toRecord);
    },
    async update(id, patch) {
      for (const [field, value] of Object.entries(patch) as [keyof typeof COLUMN_OF, Date | null][]) await query(`UPDATE api_keys SET ${COLUMN_OF[field]} = $2 WHERE id = $1`, [id, value]);
    },
  };
}

/** @deprecated use `dbApiKeyStore`; the same function, kept for one minor. */
export const pgApiKeyStore = dbApiKeyStore;
