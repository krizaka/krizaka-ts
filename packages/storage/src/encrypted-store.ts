import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { assertKey } from "./keys";
import { type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { parseSecretKey } from "./secret-key";

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** The 32-byte AES key of the encryption at rest, from its base64 form (the owner's key, passed in as a parameter). */
export const parseEncryptionKey = (base64: string): Uint8Array => parseSecretKey(base64, "The encryption key");

/**
 * Encryption at rest over any `ObjectStore` (AES-256-GCM, a fresh IV per object, the object's key as authenticated data, so a file
 * moved under another name does not open). Envelope: `1 | iv(12) | tag(16) | ciphertext(contentTypeLength(2) | contentType | bytes)`.
 * The key comes in as a parameter (from the settings or the environment, read by the product's edge); the provider only ever holds
 * ciphertext. A link to ciphertext is useless to a browser, so `signedUrl` and `publicUrl` answer `null`: the application decrypts and serves.
 * @throws StorageError `STORAGE_UNREADABLE` when an object is not an envelope or fails its integrity check
 */
export function encryptedStore(inner: ObjectStore, key: Uint8Array): ObjectStore {
  if (key.length !== 32) throw new StorageError(STORAGE_CODE.badSecretKey, "The encryption key must be 32 bytes");
  const store: ObjectStore = {
    async put(k, bytes, meta) {
      assertKey(k);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(k));
      const type = Buffer.from(meta.contentType);
      const head = Buffer.alloc(2);
      head.writeUInt16BE(type.length);
      const body = Buffer.concat([cipher.update(Buffer.concat([head, type, bytes])), cipher.final()]);
      await inner.put(k, Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]), {
        contentType: "application/octet-stream",
      });
    },
    async get(k) {
      assertKey(k);
      const found = await inner.get(k);
      if (!found) return null;
      const raw = Buffer.from(found.bytes);
      if (raw.length < HEADER_BYTES || raw[0] !== VERSION)
        throw new StorageError(STORAGE_CODE.unreadable, "Unreadable stored object");
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(1, 1 + IV_BYTES));
        decipher.setAAD(Buffer.from(k));
        decipher.setAuthTag(raw.subarray(1 + IV_BYTES, HEADER_BYTES));
        const plain = Buffer.concat([decipher.update(raw.subarray(HEADER_BYTES)), decipher.final()]);
        const typeLength = plain.readUInt16BE(0);
        return {
          contentType: plain.subarray(2, 2 + typeLength).toString(),
          bytes: new Uint8Array(plain.subarray(2 + typeLength)),
        };
      } catch {
        throw new StorageError(STORAGE_CODE.unreadable, "The stored object failed its integrity check");
      }
    },
    // The size of the plain file, read by opening it; `list` shows what the provider holds (ciphertext sizes).
    async head(k) {
      const found = await store.get(k);
      return found ? { key: k, size: found.bytes.byteLength } : null;
    },
    delete: (k) => inner.delete(assertKey(k)),
    list: (prefix) => inner.list(prefix),
    signedUrl: async () => null,
    publicUrl: () => null,
  };
  return store;
}
