import { createHash } from "node:crypto";

import { assertKey, trimSlashes, typeOfName } from "./keys";
import { type Clock, type FetchLike, type ObjectInfo, type ObjectStore, STORAGE_CODE, StorageError } from "./port";

export interface RemoteStoreOptions {
  /** The storage API host (`storage.bunnycdn.com`, or a region's). */
  endpoint: string;
  /** The zone's name, the first segment of every path. */
  zone: string;
  /** The zone's password, sent as the `AccessKey` header. Never logged, never in a link we hand out. */
  accessKey: string;
  /** Every object lives under this prefix (no slashes at the ends), or none. */
  prefix?: string;
  /** The pull zone: with it, `publicUrl` answers; with its token key too, `signedUrl` does. */
  pullHostname?: string;
  tokenKey?: string;
  fetch: FetchLike;
  clock: Clock;
}

interface Entry {
  ObjectName: string;
  IsDirectory: boolean;
  Length?: number;
}

const fail = (what: string, status: number) => new StorageError(STORAGE_CODE.provider, `the storage refused the ${what} (${status})`);

/**
 * An HTTP object store with the shape of Bunny Storage: `PUT`/`GET`/`DELETE` on `https://<endpoint>/<zone>/<prefix>/<key>` with an
 * `AccessKey` header, a directory listed by its path with a trailing slash (a JSON array of `ObjectName`, `IsDirectory`, `Length`),
 * and a pull zone for public and token-signed links. Reads and writes go through the authenticated API, never the public zone.
 */
export function remoteStore(options: RemoteStoreOptions): ObjectStore {
  const prefix = trimSlashes(options.prefix ?? "");
  const inZone = (key: string) => (prefix === "" ? "" : `${prefix}/`) + key;
  const base = `https://${options.endpoint}/${options.zone}`;
  const headers = { AccessKey: options.accessKey };
  const url = (key: string) => `${base}/${inZone(assertKey(key))}`;
  const listDir = async (dir: string): Promise<ObjectInfo[]> => {
    const res = await options.fetch(dir === "" ? `${base}/${prefix === "" ? "" : `${prefix}/`}` : `${base}/${inZone(dir)}/`, { method: "GET", headers });
    if (res.status === 404) return [];
    if (!res.ok) throw fail("listing", res.status);
    const entries = JSON.parse(await res.text()) as Entry[];
    const out: ObjectInfo[] = [];
    for (const e of entries) {
      const key = dir === "" ? e.ObjectName : `${dir}/${e.ObjectName}`;
      if (e.IsDirectory) out.push(...(await listDir(key)));
      else out.push({ key, size: e.Length ?? 0 });
    }
    return out;
  };
  const list = async (p: string) => {
    const slash = p.lastIndexOf("/");
    return (await listDir(slash < 0 ? "" : p.slice(0, slash))).filter((f) => f.key.startsWith(p)).sort((a, b) => a.key.localeCompare(b.key));
  };
  return {
    async put(key, bytes, meta) {
      const res = await options.fetch(url(key), { method: "PUT", headers: { ...headers, "content-type": meta.contentType }, body: bytes });
      if (!res.ok) throw fail("write", res.status);
    },
    async get(key) {
      const res = await options.fetch(url(key), { method: "GET", headers });
      if (res.status === 404) return null;
      if (!res.ok) throw fail("read", res.status);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? typeOfName(key) };
    },
    async head(key) {
      assertKey(key);
      return (await list(key)).find((f) => f.key === key) ?? null;
    },
    async delete(key) {
      const res = await options.fetch(url(key), { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) throw fail("delete", res.status);
    },
    list,
    async signedUrl(key, ttlSeconds) {
      if (!options.pullHostname || !options.tokenKey) return null;
      const path = `/${inZone(assertKey(key))}`;
      const expires = Math.floor(options.clock.now().valueOf() / 1000) + ttlSeconds;
      const token = createHash("sha256").update(`${options.tokenKey}${path}${expires}`).digest("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      return `https://${options.pullHostname}${path}?token=${token}&expires=${expires}`;
    },
    publicUrl: (key) => (options.pullHostname ? `https://${options.pullHostname}/${inZone(assertKey(key))}` : null),
  };
}
