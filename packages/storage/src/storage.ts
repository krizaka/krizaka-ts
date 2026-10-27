import { hashedName, type Layout } from "./keys";
import { type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { sniffType } from "./sniff";

export interface StorageLimits {
  /** The largest file accepted, in bytes. */
  maxBytes: number;
  /** Seconds a signed link lives. */
  signedUrlSeconds: number;
}

export interface StorageDeps {
  store: ObjectStore;
  layout: Layout;
  /** Read at each call so the admin's change applies at once. */
  limits: StorageLimits | (() => StorageLimits | Promise<StorageLimits>);
}

export interface UploadInput {
  /** The layout prefix the file goes under (`site/home/`). */
  prefix: string;
  /** The name the file arrives with; the stored name is `<name>.<sha10>.<ext>`. */
  name: string;
  bytes: Uint8Array;
  /** The content types this upload may be: the BYTES must be one of them, whatever the name or the declared type say. */
  allow: readonly string[];
  /** The type the client declared, when it did: it must agree with the bytes. */
  declaredType?: string;
}

export interface Storage {
  /** Checks the size, the prefix and the bytes' magic number, then stores the file under a content-hashed name. Answers its key, and a link when one exists. */
  upload(input: UploadInput): Promise<{ key: string; contentType: string; size: number; url: string | null }>;
  /** The public link when the zone has one, else a signed link, else `null`. */
  urlFor(key: string): Promise<string | null>;
  get: ObjectStore["get"];
  head: ObjectStore["head"];
  delete: ObjectStore["delete"];
  list: ObjectStore["list"];
}

/**
 * The storage of a product: an `ObjectStore` with the rules every upload obeys (a size limit passed in, a declared layout, bytes
 * checked by magic number, a content-hashed name).
 */
export function createStorage(deps: StorageDeps): Storage {
  const limits = async () => (typeof deps.limits === "function" ? await deps.limits() : deps.limits);
  const urlFor = async (key: string) => deps.store.publicUrl(key) ?? (await deps.store.signedUrl(key, (await limits()).signedUrlSeconds));
  return {
    async upload(input) {
      const { maxBytes } = await limits();
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) throw new StorageError(STORAGE_CODE.tooBig, `a file is 1 to ${maxBytes} bytes`);
      const actual = sniffType(input.bytes);
      if (actual === null || !input.allow.includes(actual)) throw new StorageError(STORAGE_CODE.badType, `the bytes are ${actual ?? "of an unknown type"}, not one of ${input.allow.join(", ")}`);
      if (input.declaredType !== undefined && input.declaredType !== actual) throw new StorageError(STORAGE_CODE.typeMismatch, `declared ${input.declaredType}, the bytes are ${actual}`);
      const key = deps.layout.check(`${input.prefix}${hashedName(input.name, input.bytes)}`);
      if (deps.layout.prefixOf(key) !== input.prefix) throw new StorageError(STORAGE_CODE.badPrefix, `« ${input.prefix} » is not a declared prefix`);
      await deps.store.put(key, input.bytes, { contentType: actual });
      return { key, contentType: actual, size: input.bytes.byteLength, url: await urlFor(key) };
    },
    urlFor,
    get: (key) => deps.store.get(key),
    head: (key) => deps.store.head(key),
    delete: (key) => deps.store.delete(key),
    list: (prefix) => deps.store.list(prefix),
  };
}
