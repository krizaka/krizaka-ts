import type { DirectUpload } from "./direct-upload";
import { assertKey, trimSlashes, typeOfName } from "./keys";
import { type Clock, type FetchLike, type ObjectInfo, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type Credentials, hashPayload, presignGet, presignPost, signRequest } from "./request-signing";

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

const fail = (what: string, status: number) =>
  new StorageError(STORAGE_CODE.provider, `the bucket refused the ${what} (${status})`);
const unescapeXml = (s: string) =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
/** One type is exact; several must share a `type/` family (a POST policy cannot say « png or pdf »). */
function contentTypeRule(types: readonly string[]): { exact: string } | { prefix: string } {
  const bad = (why: string) => new StorageError(STORAGE_CODE.badType, why);
  const unique = [...new Set(types)];
  const [first] = unique;
  if (first === undefined) throw bad("an upload needs at least one content type");
  if (unique.some((t) => !/^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/i.test(t))) throw bad("a content type is `type/subtype`");
  if (unique.length === 1) return { exact: first };
  const family = first.slice(0, first.indexOf("/") + 1);
  if (!unique.every((t) => t.startsWith(family))) throw bad("an upload policy bounds one type or one family (image/…)");
  return { prefix: family };
}
const tag = (xml: string, name: string) => new RegExp(String.raw`<${name}>([\s\S]*?)</${name}>`).exec(xml)?.[1];

/**
 * Any S3-compatible service (Spaces, a customer's bucket, MinIO) over plain HTTP: path-style URLs and Signature V4, no SDK.
 * `signedUrl` is a presigned GET; `presignUpload` a POST policy the provider enforces (size and type).
 */
export function bucketStore(options: BucketStoreOptions): ObjectStore & DirectUpload {
  const creds: Credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
    service: "s3",
  };
  const prefix = trimSlashes(options.prefix ?? "");
  const inBucket = (key: string) => (prefix === "" ? "" : `${prefix}/`) + key;
  const origin = trimSlashes(options.endpoint, "end");
  const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
  const urlOf = (key: string) => `${origin}/${options.bucket}/${encodePath(inBucket(assertKey(key)))}`;
  const send = (method: string, url: string, body?: Uint8Array, extra: Record<string, string> = {}) => {
    const headers = signRequest(creds, {
      method,
      url,
      headers: extra,
      payloadHash: hashPayload(body ?? new Uint8Array()),
      now: options.clock.now(),
    });
    // A redirect is never followed: the bucket must not point our server at another address (a 3xx is a refusal below).
    return options.fetch(url, { method, headers, redirect: "manual", ...(body ? { body } : {}) });
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
      token =
        tag(xml, "IsTruncated") === "true"
          ? unescapeXml(tag(xml, "NextContinuationToken") ?? "") || undefined
          : undefined;
    } while (token);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  };
  return {
    async put(key, bytes, meta) {
      const res = await send("PUT", urlOf(key), bytes, {
        "content-type": meta.contentType,
        ...(options.serverSideEncryption ? { "x-amz-server-side-encryption": "AES256" } : {}),
      });
      if (!res.ok) throw fail("write", res.status);
    },
    async get(key) {
      const res = await send("GET", urlOf(key));
      if (res.status === 404) return null;
      if (!res.ok) throw fail("read", res.status);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? typeOfName(key),
      };
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
    async presignUpload(key, maxBytes, contentTypes, ttlSeconds) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new StorageError(STORAGE_CODE.tooBig, "maxBytes is a whole number of bytes, at least 1");
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 604_800)
        throw new StorageError(STORAGE_CODE.badConfig, "an upload link lives 1 second to 7 days");
      const contentType = contentTypeRule(contentTypes);
      const fields = presignPost(creds, {
        bucket: options.bucket,
        key: inBucket(assertKey(key)),
        maxBytes,
        contentType,
        extra: options.serverSideEncryption ? { "x-amz-server-side-encryption": "AES256" } : {},
        ttlSeconds,
        now: options.clock.now(),
      });
      return { url: `${origin}/${options.bucket}`, fields, maxBytes };
    },
    publicUrl: (key) =>
      options.publicBaseUrl ? `${trimSlashes(options.publicBaseUrl, "end")}/${assertKey(key)}` : null,
  };
}
