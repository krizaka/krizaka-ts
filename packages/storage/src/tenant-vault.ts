import { randomBytes } from "node:crypto";

import { type KeyService, openBytes, sealBytes } from "./key-service";
import { assertKey } from "./keys";
import { type Clock, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import type { TenantKey, TenantKeyStore } from "./tenant-keys";

/**
 * Envelope encryption per tenant (ADR-020 Decision 3):
 *
 *   KMS root key ── wraps ──► tenant KEK (one per tenant and rotation, kept wrapped in the database)
 *   tenant KEK   ── wraps ──► DEK (a fresh one per object version, AES-256-GCM) ── encrypts ──► the bytes
 *
 * The provider only ever holds ciphertext. Rotating the root rewraps the KEKs (database only); rotating a tenant's KEK rewraps each
 * object's DEK in its header (the bytes are never re-encrypted); shredding a tenant destroys its KEKs, which makes every copy
 * unreadable — the replica and the backups included.
 */
export interface KeyAuditNote {
  action: "storage.key.created" | "storage.key.rotated" | "storage.key.rewrapped" | "storage.key.shredded";
  target: { type: "storage_tenant"; id: string };
  detail: Record<string, string | number>;
}

export interface TenantVaultDeps {
  kms: KeyService;
  keys: TenantKeyStore;
  clock: Clock;
  /** `@krizaka/audit`'s `record`, wired by the product: every key event is a line. */
  audit: (note: KeyAuditNote) => Promise<void>;
  /** How long an unwrapped KEK stays in this process (default 300 s): it saves KMS calls only. The key rows are read on every call, so a shred anywhere takes effect at once. 0 = no cache. */
  cacheSeconds?: number;
}

export interface TenantVault {
  /** Seals `plain` for the tenant, bound to `aad` (the object's name): a fresh DEK, wrapped under the tenant's current KEK. */
  seal(tenantId: string, aad: string, plain: Uint8Array): Promise<Uint8Array>;
  /** @throws StorageError `STORAGE_UNREADABLE` (another tenant, another name, a changed byte), `STORAGE_TENANT_SHREDDED` */
  open(tenantId: string, aad: string, sealed: Uint8Array): Promise<Uint8Array>;
  /** The same envelope with its DEK rewrapped under the current KEK, or `null` when it already is (idempotent). */
  rewrap(tenantId: string, aad: string, sealed: Uint8Array): Promise<Uint8Array | null>;
  /** A new KEK version for the tenant (on request, after an incident). Returns it. */
  rotateTenant(tenantId: string): Promise<number>;
  /** Rewraps every tenant KEK not wrapped under the KMS's current root key (`force`: all of them, after new key material). */
  rewrapRoot(options?: { force?: boolean }): Promise<{ tenants: number; rewrapped: number }>;
  /** Drops the KEK versions older than the current one: call it once `rewrap` has moved every object. */
  dropOldVersions(tenantId: string): Promise<number>;
  /** Crypto-shredding: the tenant's keys are destroyed; nothing of it opens any more, anywhere. Irreversible. */
  shredTenant(tenantId: string): Promise<void>;
}

const TENANT = /^[A-Za-z0-9_-]{1,64}$/;
// Envelope v2 (v1 is encryptedStore's single-key format): 2 | kekVersion(4) | wrappedDek(60) | iv(12) | tag(16) | ciphertext
const FORMAT = 2;
const WRAPPED_DEK = 60;
const HEADER = 1 + 4 + WRAPPED_DEK;
// @fixed: the default life of an unwrapped KEK in this process, a security trade-off stated in the ADR
const DEFAULT_CACHE_SECONDS = 300;

export const assertTenantId = (tenantId: string): string => {
  if (typeof tenantId !== "string" || !TENANT.test(tenantId))
    throw new StorageError(STORAGE_CODE.badKey, "A tenant id is 1 to 64 letters, digits, - or _");
  return tenantId;
};
const unreadable = (why: string) => new StorageError(STORAGE_CODE.unreadable, why);
const context = (tenantId: string) => ({ tenant: tenantId });
const dekAad = (tenantId: string, version: number) => `kz-dek\u0000${tenantId}\u0000${version}`;
const bodyAad = (tenantId: string, aad: string) => `kz-obj\u0000${tenantId}\u0000${aad}`;

const parseEnvelope = (sealed: Uint8Array) => {
  const raw = Buffer.from(sealed);
  if (raw.length < HEADER + 28 || raw[0] !== FORMAT) throw unreadable("Unreadable stored object");
  return { version: raw.readUInt32BE(1), wrappedDek: raw.subarray(5, HEADER), body: raw.subarray(HEADER) };
};

const packEnvelope = (version: number, wrappedDek: Uint8Array, body: Uint8Array) => {
  const head = Buffer.alloc(5);
  head[0] = FORMAT;
  head.writeUInt32BE(version, 1);
  return new Uint8Array(Buffer.concat([head, wrappedDek, body]));
};

/** The tenant keys' life: created on first use, read on every call (so a shred anywhere holds at once), unwrapped through a short cache. */
function tenantKeyring(deps: TenantVaultDeps) {
  const ttl = (deps.cacheSeconds ?? DEFAULT_CACHE_SECONDS) * 1000;
  const cache = new Map<string, { key: Uint8Array; until: number }>();
  const now = () => deps.clock.now().getTime();

  const refuseShredded = async (tenantId: string) => {
    if (await deps.keys.shreddedAt(tenantId))
      throw new StorageError(STORAGE_CODE.shredded, "This tenant's keys were destroyed: its documents are gone");
  };

  const unwrapKek = async (k: TenantKey): Promise<Uint8Array> => {
    const id = `${k.tenantId}\u0000${k.version}`;
    const hit = cache.get(id);
    if (hit && hit.until > now()) return hit.key;
    const key = await deps.kms.unwrap(k.wrapped, context(k.tenantId));
    if (ttl > 0) cache.set(id, { key, until: now() + ttl });
    return key;
  };

  const forget = (tenantId: string) => {
    for (const id of cache.keys()) if (id.startsWith(`${tenantId}\u0000`)) cache.delete(id);
  };

  const createVersion = async (tenantId: string, version: number): Promise<void> => {
    const wrapped = await deps.kms.wrap(new Uint8Array(randomBytes(32)), context(tenantId));
    if (await deps.keys.insert({ tenantId, version, wrapped, createdAt: deps.clock.now() })) {
      await deps.audit({
        action: version === 1 ? "storage.key.created" : "storage.key.rotated",
        target: { type: "storage_tenant", id: tenantId },
        detail: { version, rootKey: wrapped.keyId, kms: deps.kms.name },
      });
      return;
    }
    await refuseShredded(tenantId);
  };

  /** The current KEK, created on first use. Two processes creating it at once: one insert wins, the other reads it. */
  const current = async (tenantId: string): Promise<TenantKey> => {
    assertTenantId(tenantId);
    let versions = await deps.keys.versions(tenantId);
    if (versions.length === 0) {
      await refuseShredded(tenantId);
      await createVersion(tenantId, 1);
      versions = await deps.keys.versions(tenantId);
    }
    const last = versions.at(-1);
    if (!last) throw new StorageError(STORAGE_CODE.shredded, "This tenant's keys were destroyed");
    return last;
  };

  const versionOf = async (tenantId: string, version: number): Promise<TenantKey> => {
    const found = (await deps.keys.versions(tenantId)).find((k) => k.version === version);
    if (found) return found;
    await refuseShredded(tenantId);
    throw unreadable(`No key version ${version} for this tenant`);
  };

  return { current, versionOf, unwrapKek, createVersion, forget };
}

/** The root rewrap job: every tenant KEK not under the KMS's current root key (all of them with `force`), each one audited. */
async function rewrapRootKeys(deps: TenantVaultDeps, force: boolean) {
  const root = await deps.kms.currentKeyId();
  const tenants = await deps.keys.tenants();
  let rewrapped = 0;
  for (const tenantId of tenants)
    for (const k of await deps.keys.versions(tenantId)) {
      if (!force && k.wrapped.keyId === root) continue;
      const kek = await deps.kms.unwrap(k.wrapped, context(tenantId));
      const wrapped = await deps.kms.wrap(kek, context(tenantId));
      await deps.keys.rewrap(tenantId, k.version, wrapped);
      rewrapped += 1;
      await deps.audit({
        action: "storage.key.rewrapped",
        target: { type: "storage_tenant", id: tenantId },
        detail: { version: k.version, from: k.wrapped.keyId, to: wrapped.keyId },
      });
    }
  return { tenants: tenants.length, rewrapped };
}

export function tenantVault(deps: TenantVaultDeps): TenantVault {
  const ring = tenantKeyring(deps);
  const dekOf = async (tenantId: string, version: number, wrappedDek: Uint8Array) =>
    openBytes(wrappedDek, await ring.unwrapKek(await ring.versionOf(tenantId, version)), dekAad(tenantId, version));
  return {
    async seal(tenantId, aad, plain) {
      const k = await ring.current(tenantId);
      const dek = randomBytes(32);
      const wrappedDek = sealBytes(dek, await ring.unwrapKek(k), dekAad(tenantId, k.version));
      return packEnvelope(k.version, wrappedDek, sealBytes(plain, dek, bodyAad(tenantId, aad)));
    },
    async open(tenantId, aad, sealed) {
      assertTenantId(tenantId);
      const { version, wrappedDek, body } = parseEnvelope(sealed);
      return new Uint8Array(openBytes(body, await dekOf(tenantId, version, wrappedDek), bodyAad(tenantId, aad)));
    },
    async rewrap(tenantId, aad, sealed) {
      const { version, wrappedDek, body } = parseEnvelope(sealed);
      const k = await ring.current(tenantId);
      if (version === k.version) return null;
      const dek = await dekOf(tenantId, version, wrappedDek);
      // Proves the DEK opens this object under this name before the old KEK can be dropped.
      openBytes(body, dek, bodyAad(tenantId, aad));
      return packEnvelope(k.version, sealBytes(dek, await ring.unwrapKek(k), dekAad(tenantId, k.version)), body);
    },
    async rotateTenant(tenantId) {
      await ring.createVersion(tenantId, (await ring.current(tenantId)).version + 1);
      return (await ring.current(tenantId)).version;
    },
    rewrapRoot: (options = {}) => rewrapRootKeys(deps, options.force === true),
    async dropOldVersions(tenantId) {
      const old = (await deps.keys.versions(assertTenantId(tenantId))).slice(0, -1);
      for (const k of old) await deps.keys.drop(tenantId, k.version);
      ring.forget(tenantId);
      return old.length;
    },
    async shredTenant(tenantId) {
      const versions = (await deps.keys.versions(assertTenantId(tenantId))).length;
      await deps.keys.shred(tenantId, deps.clock.now());
      ring.forget(tenantId);
      await deps.audit({
        action: "storage.key.shredded",
        target: { type: "storage_tenant", id: tenantId },
        detail: { versions },
      });
    },
  };
}

/**
 * A tenant's `ObjectStore` over any store (an S3-compatible bucket, a folder in tests): every key lives under `t/<tenantId>/`, so a
 * tenant cannot even name another tenant's objects, and every object is sealed by `vault` with its full key as associated data (an
 * object copied under another name or another tenant does not open). Links answer `null`: the service decrypts and streams.
 */
export function tenantStore(
  inner: ObjectStore,
  vault: TenantVault,
  tenantId: string,
): ObjectStore & {
  /** Rewraps every object of the tenant under its current KEK; returns how many moved. Idempotent, resumable. */
  rewrapAll(): Promise<number>;
} {
  const prefix = `t/${assertTenantId(tenantId)}/`;
  const full = (key: string) => prefix + assertKey(key);
  const store = {
    async put(key: string, bytes: Uint8Array, meta: { contentType: string }) {
      const type = Buffer.from(meta.contentType);
      const head = Buffer.alloc(2);
      head.writeUInt16BE(type.length);
      const sealed = await vault.seal(tenantId, full(key), Buffer.concat([head, type, bytes]));
      await inner.put(full(key), sealed, { contentType: "application/octet-stream" });
    },
    async get(key: string) {
      const found = await inner.get(full(key));
      if (!found) return null;
      const plain = Buffer.from(await vault.open(tenantId, full(key), found.bytes));
      const length = plain.readUInt16BE(0);
      return {
        contentType: plain.subarray(2, 2 + length).toString(),
        bytes: new Uint8Array(plain.subarray(2 + length)),
      };
    },
    async head(key: string) {
      const found = await store.get(key);
      return found ? { key, size: found.bytes.byteLength } : null;
    },
    delete: (key: string) => inner.delete(full(key)),
    async list(start: string) {
      return (await inner.list(prefix + start)).map((o) => ({ key: o.key.slice(prefix.length), size: o.size }));
    },
    signedUrl: async () => null,
    publicUrl: () => null,
    async rewrapAll() {
      let moved = 0;
      for (const o of await inner.list(prefix)) {
        const found = await inner.get(o.key);
        if (!found) continue;
        const next = await vault.rewrap(tenantId, o.key, found.bytes);
        if (!next) continue;
        await inner.put(o.key, next, { contentType: "application/octet-stream" });
        moved += 1;
      }
      return moved;
    },
  };
  return store;
}
