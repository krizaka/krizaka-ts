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
