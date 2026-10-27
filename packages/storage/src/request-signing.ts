import crypto from "node:crypto";

/** AWS Signature Version 4, the part of it any S3-compatible provider needs (header signing and presigned URLs). Dependency-free. */
const sha256 = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: crypto.BinaryLike | crypto.KeyObject, data: string) => crypto.createHmac("sha256", key).update(data).digest();
export const EMPTY_SHA256 = sha256("");
export const hashPayload = (bytes: Uint8Array) => sha256(bytes);

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

const stamp = (now: Date) => now.toISOString().replace(/[:-]|\.\d{3}/g, "");
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const canonicalPath = (url: URL) =>
  url.pathname
    .split("/")
    .map((seg) => encode(decodeURIComponent(seg)))
    .join("/") || "/";
const byNameThenValue = ([a, av]: readonly [string, string], [b, bv]: readonly [string, string]) => {
  if (a === b) return av < bv ? -1 : 1;
  return a < b ? -1 : 1;
};
const canonicalQuery = (url: URL) =>
  [...url.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(byNameThenValue)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

function signingKey(c: Credentials, date: string) {
  return hmac(hmac(hmac(hmac(`AWS4${c.secretAccessKey}`, date), c.region), c.service), "aws4_request");
}

function signature(c: Credentials, method: string, url: URL, headers: Record<string, string>, payloadHash: string, amzDate: string) {
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const canonical = [method, canonicalPath(url), canonicalQuery(url), names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${amzDate.slice(0, 8)}/${c.region}/${c.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  return { signed: names.join(";"), scope, value: crypto.createHmac("sha256", signingKey(c, amzDate.slice(0, 8))).update(toSign).digest("hex") };
}

/** The headers of a signed request: `authorization`, `x-amz-date` and, for S3, `x-amz-content-sha256` (give the headers you send, without host). */
export function signRequest(c: Credentials, req: { method: string; url: string; headers?: Record<string, string>; payloadHash: string; now: Date }) {
  const url = new URL(req.url);
  const amzDate = stamp(req.now);
  const extra: Record<string, string> = c.service === "s3" ? { "x-amz-content-sha256": req.payloadHash } : {};
  const s = signature(c, req.method, url, { ...req.headers, host: url.host, "x-amz-date": amzDate, ...extra }, req.payloadHash, amzDate);
  return { ...req.headers, "x-amz-date": amzDate, ...extra, authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${s.scope}, SignedHeaders=${s.signed}, Signature=${s.value}` };
}

/** A presigned GET URL, valid for `ttlSeconds`. */
export function presignGet(c: Credentials, url: string, ttlSeconds: number, now: Date): string {
  const u = new URL(url);
  const amzDate = stamp(now);
  u.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  u.searchParams.set("X-Amz-Credential", `${c.accessKeyId}/${amzDate.slice(0, 8)}/${c.region}/${c.service}/aws4_request`);
  u.searchParams.set("X-Amz-Date", amzDate);
  u.searchParams.set("X-Amz-Expires", String(ttlSeconds));
  u.searchParams.set("X-Amz-SignedHeaders", "host");
  const s = signature(c, "GET", u, { host: u.host }, "UNSIGNED-PAYLOAD", amzDate);
  u.searchParams.set("X-Amz-Signature", s.value);
  return u.toString();
}
