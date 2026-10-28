import { ident, type Query } from "@krizaka/db";

import type { ProviderRecord, ProviderStore } from "./provider-records";

/** The in-memory store, for unit tests. */
export function memoryProviderStore(): ProviderStore {
  const rows = new Map<string, ProviderRecord>();
  const defaults = new Map<string, string>();
  const copy = (r: ProviderRecord): ProviderRecord => structuredClone(r);
  return {
    async insert(record) {
      rows.set(record.id, copy(record));
    },
    async get(id) {
      const r = rows.get(id);
      return r ? copy(r) : null;
    },
    async list(scope) {
      return [...rows.values()].filter((r) => scope === undefined || r.scope === scope).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)).map(copy);
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (!r) return null;
      const next = { ...r, ...structuredClone(patch) };
      rows.set(id, next);
      return copy(next);
    },
    async setDefault(scope, dataKind, providerId) {
      defaults.set(`${scope}\u0000${dataKind}`, providerId);
    },
    async defaultFor(scope, dataKind) {
      return defaults.get(`${scope}\u0000${dataKind}`) ?? null;
    },
    async defaults(scope) {
      return Object.fromEntries([...defaults].filter(([k]) => k.startsWith(`${scope}\u0000`)).map(([k, v]) => [k.slice(scope.length + 1), v]));
    },
  };
}

interface Row {
  id: string;
  scope: string;
  kind: string;
  preset: string | null;
  label: string;
  coordinates: Record<string, string>;
  sealed_credentials: string;
  key_id: string;
  status: ProviderRecord["status"];
  source: ProviderRecord["source"];
  last_test: (Omit<NonNullable<ProviderRecord["lastTest"]>, "at"> & { at: string }) | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const toRecord = (r: Row): ProviderRecord => ({
  id: r.id, scope: r.scope, kind: r.kind, preset: r.preset, label: r.label, coordinates: r.coordinates, sealedCredentials: r.sealed_credentials, keyId: r.key_id,
  status: r.status, source: r.source, lastTest: r.last_test ? { ...r.last_test, at: new Date(r.last_test.at) } : null, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const COLUMN = { label: "label", coordinates: "coordinates", sealedCredentials: "sealed_credentials", keyId: "key_id", status: "status", lastTest: "last_test", updatedAt: "updated_at" } as const;
const JSON_COLUMNS = new Set(["coordinates", "lastTest"]);

/** The PostgreSQL store, on `<schema>.provider` and `<schema>.default_provider` (`storageSchema`), over the product's query. */
export function dbProviderStore(query: Query, schema = "storage"): ProviderStore {
  const provider = `${ident(schema)}.provider`;
  const defaults = `${ident(schema)}.default_provider`;
  return {
    async insert(r) {
      await query(
        `INSERT INTO ${provider} (id, scope, kind, preset, label, coordinates, sealed_credentials, key_id, status, source, last_test, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [r.id, r.scope, r.kind, r.preset, r.label, JSON.stringify(r.coordinates), r.sealedCredentials, r.keyId, r.status, r.source, r.lastTest ? JSON.stringify(r.lastTest) : null, r.createdBy, r.createdAt, r.updatedAt],
      );
    },
    async get(id) {
      const rows = await query<Row>(`SELECT * FROM ${provider} WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async list(scope) {
      const rows = scope === undefined ? await query<Row>(`SELECT * FROM ${provider} ORDER BY created_at, id`) : await query<Row>(`SELECT * FROM ${provider} WHERE scope = $1 ORDER BY created_at, id`, [scope]);
      return rows.map(toRecord);
    },
    async update(id, patch) {
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof typeof COLUMN, unknown][];
      if (entries.length === 0) return this.get(id);
      const sets = entries.map(([k], i) => `${COLUMN[k]} = $${i + 2}`).join(", ");
      const params = entries.map(([k, v]) => (JSON_COLUMNS.has(k) && v !== null ? JSON.stringify(v) : v));
      const rows = await query<Row>(`UPDATE ${provider} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...params]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async setDefault(scope, dataKind, providerId) {
      await query(`INSERT INTO ${defaults} (scope, data_kind, provider_id) VALUES ($1,$2,$3) ON CONFLICT (scope, data_kind) DO UPDATE SET provider_id = EXCLUDED.provider_id`, [scope, dataKind, providerId]);
    },
    async defaultFor(scope, dataKind) {
      return (await query<{ provider_id: string }>(`SELECT provider_id FROM ${defaults} WHERE scope = $1 AND data_kind = $2`, [scope, dataKind]))[0]?.provider_id ?? null;
    },
    async defaults(scope) {
      return Object.fromEntries((await query<{ data_kind: string; provider_id: string }>(`SELECT data_kind, provider_id FROM ${defaults} WHERE scope = $1`, [scope])).map((r) => [r.data_kind, r.provider_id]));
    },
  };
}
