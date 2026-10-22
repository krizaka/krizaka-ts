import { compareAsc } from "date-fns";

import type { ApiKeyRecord, ApiKeyStore } from "./port";

/** An in-memory store: the tests' adapter, and the reference the contract is written against. */
export function memoryApiKeyStore(): ApiKeyStore {
  const rows = new Map<string, ApiKeyRecord>();
  const copy = (r: ApiKeyRecord): ApiKeyRecord => ({ ...r, scopes: [...r.scopes] });
  return {
    async insert(record) {
      if ([...rows.values()].some((r) => r.publicId === record.publicId)) throw new Error("publicId taken");
      rows.set(record.id, copy(record));
    },
    async get(id) {
      const r = rows.get(id);
      return r ? copy(r) : null;
    },
    async findByPublicId(publicId) {
      const r = [...rows.values()].find((x) => x.publicId === publicId);
      return r ? copy(r) : null;
    },
    async list(ownerId) {
      return [...rows.values()].filter((r) => r.ownerId === ownerId).map(copy).sort((a, b) => compareAsc(a.createdAt, b.createdAt));
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (r) Object.assign(r, patch);
    },
  };
}
