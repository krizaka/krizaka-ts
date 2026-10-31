import { ident, type Query } from "@krizaka/db";

import type { WrappedKey } from "./key-service";

/**
 * A tenant's key-encryption key (KEK), as the database keeps it: wrapped by the KMS root key, never in clear. A tenant has one
 * version per rotation; the highest one wraps the new data keys, the older ones still open what they wrapped until the rewrap job
 * has moved every object.
 */
export interface TenantKey {
  tenantId: string;
  version: number;
  wrapped: WrappedKey;
  createdAt: Date;
}

/** Where the tenant keys live. Every adapter runs `tenantKeyStoreContract` (`@krizaka/storage/testkit`). */
export interface TenantKeyStore {
  /** Every version of the tenant, oldest first; `[]` for a tenant with no key yet, or shredded. */
  versions(tenantId: string): Promise<TenantKey[]>;
  /**
   * Adds a version. `false` when that version already exists (a concurrent creation won: read again) or when the tenant is
   * shredded (its keys never come back).
   */
  insert(key: TenantKey): Promise<boolean>;
  /** Replaces the wrapped form of one version (the root key changed); the KEK itself is the same. */
  rewrap(tenantId: string, version: number, wrapped: WrappedKey): Promise<void>;
  /** Forgets one old version, once no object uses it. */
  drop(tenantId: string, version: number): Promise<void>;
  /** Crypto-shredding: records the tombstone first, then deletes every version. Idempotent. */
  shred(tenantId: string, at: Date): Promise<void>;
  shreddedAt(tenantId: string): Promise<Date | null>;
  /** Every tenant that holds a key, for the root rewrap job. */
  tenants(): Promise<string[]>;
}

export function memoryTenantKeyStore(): TenantKeyStore {
  const rows = new Map<string, TenantKey[]>();
  const shredded = new Map<string, Date>();
  const copy = (k: TenantKey): TenantKey => structuredClone(k);
  return {
    async versions(tenantId) {
      return (rows.get(tenantId) ?? []).map(copy).sort((a, b) => a.version - b.version);
    },
    async insert(key) {
      if (shredded.has(key.tenantId)) return false;
      const list = rows.get(key.tenantId) ?? [];
      if (list.some((k) => k.version === key.version)) return false;
      rows.set(key.tenantId, [...list, copy(key)]);
      return true;
    },
    async rewrap(tenantId, version, wrapped) {
      for (const k of rows.get(tenantId) ?? []) if (k.version === version) k.wrapped = { ...wrapped };
    },
    async drop(tenantId, version) {
      rows.set(
        tenantId,
        (rows.get(tenantId) ?? []).filter((k) => k.version !== version),
      );
    },
    async shred(tenantId, at) {
      if (!shredded.has(tenantId)) shredded.set(tenantId, at);
      rows.delete(tenantId);
    },
    shreddedAt: async (tenantId) => shredded.get(tenantId) ?? null,
    tenants: async () =>
      [...rows.keys()].filter((t) => (rows.get(t) ?? []).length > 0).sort((a, b) => a.localeCompare(b)),
  };
}

/** The SQL of `storageSchema` version 2 (`tenant_keyring`, `tenant_key`). Frozen once released. */
export const tenantKeysMigration = (schema: string) => `
CREATE TABLE ${schema}.tenant_keyring (
  tenant_id   text PRIMARY KEY CHECK (tenant_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  shredded_at timestamptz
);
CREATE TABLE ${schema}.tenant_key (
  tenant_id  text NOT NULL REFERENCES ${schema}.tenant_keyring(tenant_id),
  version    integer NOT NULL CHECK (version > 0),
  root_key   text NOT NULL,
  wrapped    text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, version)
);`;

interface Row {
  tenant_id: string;
  version: number;
  root_key: string;
  wrapped: string;
  created_at: Date;
}

/**
 * The PostgreSQL store (`storageSchema` v2), over the product's query. Race-free without a transaction: a new version is inserted
 * only while its keyring row says « not shredded », read `FOR SHARE`; `shred` marks that row first (a row lock that waits for
 * any insert in flight), then deletes the versions. An insert that comes after the mark finds it and is refused.
 */
export function dbTenantKeyStore(query: Query, schema = "storage"): TenantKeyStore {
  const ring = `${ident(schema)}.tenant_keyring`;
  const keys = `${ident(schema)}.tenant_key`;
  return {
    async versions(tenantId) {
      const rows = await query<Row>(`SELECT * FROM ${keys} WHERE tenant_id = $1 ORDER BY version`, [tenantId]);
      return rows.map((r) => ({
        tenantId: r.tenant_id,
        version: r.version,
        wrapped: { keyId: r.root_key, ciphertext: r.wrapped },
        createdAt: r.created_at,
      }));
    },
    async insert(k) {
      await query(`INSERT INTO ${ring} (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [k.tenantId]);
      const rows = await query(
        `WITH live AS (SELECT tenant_id FROM ${ring} WHERE tenant_id = $1 AND shredded_at IS NULL FOR SHARE)
         INSERT INTO ${keys} (tenant_id, version, root_key, wrapped, created_at)
         SELECT tenant_id, $2, $3, $4, $5 FROM live
         ON CONFLICT DO NOTHING RETURNING version`,
        [k.tenantId, k.version, k.wrapped.keyId, k.wrapped.ciphertext, k.createdAt],
      );
      return rows.length === 1;
    },
    async rewrap(tenantId, version, wrapped) {
      await query(`UPDATE ${keys} SET root_key = $3, wrapped = $4 WHERE tenant_id = $1 AND version = $2`, [
        tenantId,
        version,
        wrapped.keyId,
        wrapped.ciphertext,
      ]);
    },
    async drop(tenantId, version) {
      await query(`DELETE FROM ${keys} WHERE tenant_id = $1 AND version = $2`, [tenantId, version]);
    },
    async shred(tenantId, at) {
      await query(
        `INSERT INTO ${ring} (tenant_id, shredded_at) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET shredded_at = COALESCE(${ring}.shredded_at, EXCLUDED.shredded_at)`,
        [tenantId, at],
      );
      await query(`DELETE FROM ${keys} WHERE tenant_id = $1`, [tenantId]);
    },
    async shreddedAt(tenantId) {
      const rows = await query<{ shredded_at: Date | null }>(`SELECT shredded_at FROM ${ring} WHERE tenant_id = $1`, [
        tenantId,
      ]);
      return rows[0]?.shredded_at ?? null;
    },
    async tenants() {
      const rows = await query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id FROM ${keys} ORDER BY tenant_id`);
      return rows.map((r) => r.tenant_id);
    },
  };
}
