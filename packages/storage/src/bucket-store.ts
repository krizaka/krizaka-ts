import { assertKey, typeOfName } from "./keys";
import { type Clock, type FetchLike, type ObjectInfo, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type Credentials, hashPayload, presignGet, signRequest } from "./request-signing";

export interface BucketStoreOptions {
  /** The provider's origin: `https://tor1.digitaloceanspaces.com`, `https://s3.example.com`, `http://localhost:9000`. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Every object lives under this prefix (no slashes at the ends), or none. */
  prefix?: string;
  /** Where the bucket is served publicly (a CDN in front of it), or none: the bucket is private. */
  publicBaseUrl?: string;
  /** Ask the provider to encrypt at rest (`AES256`). */
  serverSideEncryption?: boolean;
  fetch: FetchLike;
  clock: Clock;
}

const fail = (what: string, status: number) => new StorageError(STORAGE_CODE.provider, `the bucket refused the ${what} (${status})`);
const unescapeXml = (s: string) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
const tag = (xml: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];

/**
 * Any S3-compatible service (Spaces, a customer's bucket, MinIO) over plain HTTP: path-style URLs and Signature V4, no SDK.
 * `signedUrl` is a presigned GET.
 */
export function bucketStore(options: BucketStoreOptions): ObjectStore {
  const creds: Credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, region: options.region, service: "s3" };
  const prefix = (options.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const inBucket = (key: string) => (prefix === "" ? "" : `${prefix}/`) + key;
  const origin = options.endpoint.replace(/\/+$/, "");
  const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
  const urlOf = (key: string) => `${origin}/${options.bucket}/${encodePath(inBucket(assertKey(key)))}`;
  const send = (method: string, url: string, body?: Uint8Array, extra: Record<string, string> = {}) => {
    const headers = signRequest(creds, { method, url, headers: extra, payloadHash: hashPayload(body ?? new Uint8Array()), now: options.clock.now() });
    return options.fetch(url, { method, headers, ...(body ? { body } : {}) });
  };
  const list = async (p: string): Promise<ObjectInfo[]> => {
    const out: ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const q = new URL(`${origin}/${options.bucket}`);
      q.searchParams.set("list-type", "2");
      q.searchParams.set("prefix", inBucket(p));
      if (token) q.searchParams.set("continuation-token", token);
      const res = await send("GET", q.toString());
      if (!res.ok) throw fail("listing", res.status);
      const xml = await res.text();
      for (const block of xml.split("<Contents>").slice(1)) {
        const key = unescapeXml(tag(block, "Key") ?? "");
        out.push({ key: prefix === "" ? key : key.slice(prefix.length + 1), size: Number(tag(block, "Size") ?? 0) });
      }
      token = tag(xml, "IsTruncated") === "true" ? unescapeXml(tag(xml, "NextContinuationToken") ?? "") || undefined : undefined;
    } while (token);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  };
  return {
    async put(key, bytes, meta) {
      const res = await send("PUT", urlOf(key), bytes, { "content-type": meta.contentType, ...(options.serverSideEncryption ? { "x-amz-server-side-encryption": "AES256" } : {}) });
      if (!res.ok) throw fail("write", res.status);
    },
    async get(key) {
      const res = await send("GET", urlOf(key));
      if (res.status === 404) return null;
      if (!res.ok) throw fail("read", res.status);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? typeOfName(key) };
    },
    async head(key) {
      const res = await send("HEAD", urlOf(key));
      if (res.status === 404) return null;
      if (!res.ok) throw fail("head", res.status);
      return { key, size: Number(res.headers.get("content-length") ?? 0) };
    },
    async delete(key) {
      const res = await send("DELETE", urlOf(key));
      if (!res.ok && res.status !== 404) throw fail("delete", res.status);
    },
    list,
    async signedUrl(key, ttlSeconds) {
      return presignGet(creds, urlOf(key), ttlSeconds, options.clock.now());
    },
    publicUrl: (key) => (options.publicBaseUrl ? `${options.publicBaseUrl.replace(/\/+$/, "")}/${assertKey(key)}` : null),
  };
}
