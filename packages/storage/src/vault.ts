import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { STORAGE_CODE, StorageError } from "./port";
import { parseSecretKey } from "./secret-key";

/** The 32-byte key of the vault, from its base64 form (the deployment's, passed in). */
export const parseVaultKey = (base64: string): Uint8Array => parseSecretKey(base64, "The vault key");

/**
 * Seals a credential for the database (AES-256-GCM, a fresh IV, `v1.<iv|tag|ciphertext>` in base64url). A leaked table opens
 * nothing, and a sealed value is never sent back to the browser: the admin screen shows « set » or « not set ».
 */
export function seal(secret: string, key: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** @throws StorageError `STORAGE_UNREADABLE` for a value that is not sealed, was tampered with, or sealed under another key */
export function open(sealed: string, key: Uint8Array): string {
  if (!sealed.startsWith("v1.")) throw new StorageError(STORAGE_CODE.unreadable, "Unreadable sealed value");
  try {
    const raw = Buffer.from(sealed.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new StorageError(STORAGE_CODE.unreadable, "The sealed value failed its integrity check");
  }
}

/** The key-encryption keys held in this process: by `key_id` for `v2.` values, and the old single key (`legacy`) that still opens `v1.` values. */
export interface LocalKeys {
  keys: Readonly<Record<string, Uint8Array>>;
  legacy?: Uint8Array;
}

type Maybe<T> = T | Promise<T>;

/**
 * The key port (ADR-005 amendment, krizaka-ts#239): all the vault asks of the key-encryption key is to wrap and unwrap a 32-byte data
 * key. `localKeyring` does it in this process (the default); a KMS (AWS KMS ca-central-1, OVHcloud KMS, Vault transit) implements the
 * same three members and the key never reaches the app. The stored `v2.<key_id>.<wrapped data key>.<sealed secret>` format is the
 * same either way, so moving to a KMS is a re-wrap, not a re-entry.
 */
export interface Keyring {
  /** The `key_id` new values are wrapped under. */
  readonly keyId: string;
  /** The data key wrapped under `keyId`, as base64url text. */
  wrap(dataKey: Uint8Array, keyId: string): Maybe<string>;
  /** @throws StorageError `STORAGE_UNREADABLE` when `keyId` is unknown here or the wrapped key fails its check */
  unwrap(wrapped: string, keyId: string): Maybe<Uint8Array>;
  /** Opens a `v1.` value (the single old key), when this ring still has it. */
  openLegacy?(sealed: string): string;
}

/** The in-process keyring: `key` is the current key-encryption key (named `keyId`), `ring` the older ones still needed to open values. */
export function localKeyring(input: { keyId: string; key: Uint8Array; ring: LocalKeys }): Keyring {
  const keyFor = (keyId: string): Uint8Array => {
    const kek = keyId === input.keyId ? input.key : input.ring.keys[keyId];
    if (!kek) throw unreadable(`No vault key ${keyId}`);
    return kek;
  };
  const legacy = input.ring.legacy;
  return {
    keyId: input.keyId,
    wrap: (dataKey, keyId) => gcm(dataKey, keyFor(keyId), keyId),
    unwrap: (wrapped, keyId) => ungcm(wrapped, keyFor(keyId), keyId),
    ...(legacy ? { openLegacy: (sealed: string) => open(sealed, legacy) } : {}),
  };
}

const BODY_AAD = "body";
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const unreadable = (why: string) => new StorageError(STORAGE_CODE.unreadable, why);

function gcm(plain: Uint8Array, key: Uint8Array, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function ungcm(packed: string, key: Uint8Array, aad: string): Buffer {
  try {
    const raw = Buffer.from(packed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    throw unreadable("The sealed value failed its integrity check");
  }
}

/**
 * Envelope encryption (ADR-005): a fresh data key seals the secret, and the key-encryption key (`MEDIA_VAULT_KEY`, named by `keyId`)
 * wraps the data key. `v2.<key_id>.<wrapped data key>.<sealed secret>`. Rotating the key-encryption key re-wraps the data key only
 * (`rewrapEnvelope`): no credential is retyped.
 */
export function sealEnvelope(secret: string, kek: Uint8Array, keyId: string): string {
  if (!KEY_ID.test(keyId)) throw new StorageError(STORAGE_CODE.badConfig, "The vault key id is 1 to 32 letters, digits, - or _");
  const dataKey = randomBytes(32);
  return `v2.${keyId}.${gcm(dataKey, kek, keyId)}.${gcm(Buffer.from(secret, "utf8"), dataKey, BODY_AAD)}`;
}

/** The `key_id` a sealed value was wrapped under, or `null` for a `v1.` value (sealed by the single key). */
export function keyIdOf(sealed: string): string | null {
  const [version, keyId] = sealed.split(".");
  return version === "v2" && keyId && KEY_ID.test(keyId) ? keyId : null;
}

function unwrap(sealed: string, ring: LocalKeys): { dataKey: Buffer; keyId: string; body: string } {
  const [version, keyId, wrapped, body] = sealed.split(".");
  if (version !== "v2" || !keyId || !wrapped || !body) throw unreadable("Unreadable sealed value");
  const kek = ring.keys[keyId];
  if (!kek) throw unreadable(`No vault key ${keyId}`);
  return { dataKey: ungcm(wrapped, kek, keyId), keyId, body };
}

/** Opens a `v2.` value with the key named in it, or a `v1.` value with the legacy key. @throws StorageError `STORAGE_UNREADABLE` */
export function openEnvelope(sealed: string, ring: LocalKeys): string {
  if (sealed.startsWith("v1.")) {
    if (!ring.legacy) throw unreadable("No legacy vault key for a v1 value");
    return open(sealed, ring.legacy);
  }
  const { dataKey, body } = unwrap(sealed, ring);
  return ungcm(body, dataKey, BODY_AAD).toString("utf8");
}

/** Re-wraps the data key under `to` (the rotation): the sealed secret is untouched. A `v1.` value is opened and sealed as `v2.`. */
export function rewrapEnvelope(sealed: string, ring: LocalKeys, to: { keyId: string; key: Uint8Array }): string {
  if (sealed.startsWith("v1.")) return sealEnvelope(openEnvelope(sealed, ring), to.key, to.keyId);
  if (!KEY_ID.test(to.keyId)) throw new StorageError(STORAGE_CODE.badConfig, "The vault key id is 1 to 32 letters, digits, - or _");
  const { dataKey, body } = unwrap(sealed, ring);
  return `v2.${to.keyId}.${gcm(dataKey, to.key, to.keyId)}.${body}`;
}

function parts(sealed: string): { keyId: string; wrapped: string; body: string } {
  const [version, keyId, wrapped, body] = sealed.split(".");
  if (version !== "v2" || !keyId || !wrapped || !body) throw unreadable("Unreadable sealed value");
  return { keyId, wrapped, body };
}

const assertKeyId = (keyId: string) => {
  if (!KEY_ID.test(keyId)) throw new StorageError(STORAGE_CODE.badConfig, "The vault key id is 1 to 32 letters, digits, - or _");
};

/** `sealEnvelope` through a keyring (a KMS can wrap the data key): `v2.<ring.keyId>…`. */
export async function sealWith(ring: Keyring, secret: string): Promise<string> {
  assertKeyId(ring.keyId);
  const dataKey = randomBytes(32);
  return `v2.${ring.keyId}.${await ring.wrap(dataKey, ring.keyId)}.${gcm(Buffer.from(secret, "utf8"), dataKey, BODY_AAD)}`;
}

/** `openEnvelope` through a keyring. @throws StorageError `STORAGE_UNREADABLE` */
export async function openWith(ring: Keyring, sealed: string): Promise<string> {
  if (sealed.startsWith("v1.")) {
    if (!ring.openLegacy) throw unreadable("No legacy vault key for a v1 value");
    return ring.openLegacy(sealed);
  }
  const { keyId, wrapped, body } = parts(sealed);
  return ungcm(body, Buffer.from(await ring.unwrap(wrapped, keyId)), BODY_AAD).toString("utf8");
}

/** `rewrapEnvelope` through a keyring: the data key is re-wrapped under `ring.keyId`; the sealed secret is untouched. */
export async function rewrapWith(ring: Keyring, sealed: string): Promise<string> {
  if (sealed.startsWith("v1.")) return sealWith(ring, await openWith(ring, sealed));
  assertKeyId(ring.keyId);
  const { keyId, wrapped, body } = parts(sealed);
  const dataKey = await ring.unwrap(wrapped, keyId);
  return `v2.${ring.keyId}.${await ring.wrap(dataKey, ring.keyId)}.${body}`;
}
