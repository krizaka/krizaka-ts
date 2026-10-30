import { STORAGE_CODE, StorageError } from "./port";

const KEY_BYTES = 32;

/** A 32-byte key given in base64 (the form an environment variable or a secret manager holds). Anything else is refused: no weaker key is ever made up. */
export function parseSecretKey(base64: string, what: string): Uint8Array {
  const key = Uint8Array.from(Buffer.from(base64, "base64"));
  if (key.length !== KEY_BYTES)
    throw new StorageError(STORAGE_CODE.badSecretKey, `${what} must be ${KEY_BYTES} bytes in base64`);
  return key;
}
