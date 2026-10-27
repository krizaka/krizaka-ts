import { assertKey, trimSlashes, typeOfName } from "./keys";
import type { ObjectStore } from "./port";

/** An in-memory store, for unit tests and demos: the behaviour of the others (the contract kit runs on all). */
export function memoryObjectStore(options: { publicBaseUrl?: string } = {}): ObjectStore {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, bytes, meta) {
      files.set(assertKey(key), { bytes: new Uint8Array(bytes), contentType: meta.contentType });
    },
    async get(key) {
      const f = files.get(assertKey(key));
      return f ? { bytes: new Uint8Array(f.bytes), contentType: f.contentType || typeOfName(key) } : null;
    },
    async head(key) {
      const f = files.get(assertKey(key));
      return f ? { key, size: f.bytes.byteLength } : null;
    },
    async delete(key) {
      files.delete(assertKey(key));
    },
    async list(prefix) {
      return [...files.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, f]) => ({ key, size: f.bytes.byteLength }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
    async signedUrl() {
      return null;
    },
    publicUrl: (key) => (options.publicBaseUrl ? `${trimSlashes(options.publicBaseUrl, "end")}/${assertKey(key)}` : null),
  };
}
