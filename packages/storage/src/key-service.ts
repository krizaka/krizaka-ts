import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { STORAGE_CODE, StorageError } from "./port";

/**
 * The key-management port of the managed storage (ADR-020 Decision 3): a KMS holds the **root key**, which never leaves it; all the
 * storage asks of it is to wrap and unwrap a 32-byte key (a tenant's key-encryption key), bound to a context the KMS authenticates.
 * Adapters: `memoryKeyService` (tests and a developer's machine), `cloudKeyService` for AWS KMS and OVHcloud KMS (`./cloud-keys`).
 * Every adapter runs `keyServiceContract` (`@krizaka/storage/testkit`). Which KMS, which key: the administrator's settings.
 */
export interface WrappedKey {
  /** The root key that wrapped it, as the KMS names it (an ARN, an OKMS key id, `local:v2`). */
  keyId: string;
  /** The KMS's ciphertext, as text (base64 or the KMS's own format). */
  ciphertext: string;
}

/** Authenticated, never secret: the KMS refuses to unwrap under another context. Always `{ tenant: <id> }` here. */
export type KeyContext = Readonly<Record<string, string>>;

export interface KeyService {
  /** For the audit trail and the admin screen: `memory`, `aws-kms`, `okms`. */
  readonly name: string;
  /** The root key new keys are wrapped under. */
  currentKeyId(): Promise<string>;
  wrap(plain: Uint8Array, context: KeyContext): Promise<WrappedKey>;
  /** @throws StorageError `STORAGE_UNREADABLE` when the KMS refuses (another context, a destroyed key, tampered ciphertext) */
  unwrap(wrapped: WrappedKey, context: KeyContext): Promise<Uint8Array>;
  /**
   * New key material for the root key; the old versions keep unwrapping. A KMS that rotates only from its console omits it: the
   * admin then names a new root key in the settings and runs the rewrap job.
   */
  rotate?(): Promise<string>;
}

const unreadable = (why: string) => new StorageError(STORAGE_CODE.unreadable, why);

/** `{ tenant: "a" }` → `tenant=a`, keys sorted: the same context always gives the same bytes. */
export const contextText = (context: KeyContext): string =>
  Object.keys(context)
    .sort((a, b) => (a < b ? -1 : 1))
    .map((k) => `${k}=${context[k]}`)
    .join("&");

/** AES-256-GCM with associated data: `iv(12) | tag(16) | ciphertext`. The one primitive of the envelope (node:crypto, no dependency). */
export function sealBytes(plain: Uint8Array, key: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** @throws StorageError `STORAGE_UNREADABLE` on a wrong key, other associated data, or any changed byte */
export function openBytes(packed: Uint8Array, key: Uint8Array, aad: string): Buffer {
  const raw = Buffer.from(packed);
  if (raw.length < 28) throw unreadable("Unreadable sealed bytes");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    throw unreadable("The sealed bytes failed their integrity check");
  }
}

/**
 * The local KMS, for tests and a developer's machine: root key versions held in this process (`local:v1`, `local:v2`…), rotation
 * keeps the old ones, `destroy` forgets one (what a KMS does at the end of a key's deletion window). Never for production data: the
 * root key is in the process memory.
 */
export function memoryKeyService(
  input: {
    name?: string;
    random?: (n: number) => Uint8Array;
    /** A fixed first root key (32 bytes): a developer's data survives a restart. */ root?: Uint8Array;
  } = {},
): KeyService & {
  rotate(): Promise<string>;
  destroy(keyId: string): void;
} {
  const random = input.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const versions = new Map<string, Uint8Array>();
  let current = "";
  const next = (fixed?: Uint8Array) => {
    current = `local:v${versions.size + 1}`;
    versions.set(current, fixed ?? random(32));
    return current;
  };
  if (input.root && input.root.length !== 32)
    throw new StorageError(STORAGE_CODE.badSecretKey, "The local root key must be 32 bytes");
  next(input.root);
  return {
    name: input.name ?? "memory",
    currentKeyId: async () => current,
    async wrap(plain, context) {
      const root = versions.get(current);
      if (!root) throw unreadable(`The root key ${current} is not available`);
      return { keyId: current, ciphertext: sealBytes(plain, root, contextText(context)).toString("base64") };
    },
    async unwrap(wrapped, context) {
      const root = versions.get(wrapped.keyId);
      if (!root) throw unreadable(`The root key ${wrapped.keyId} is not available`);
      return new Uint8Array(openBytes(Buffer.from(wrapped.ciphertext, "base64"), root, contextText(context)));
    },
    rotate: async () => next(),
    destroy(keyId) {
      versions.delete(keyId);
    },
  };
}
