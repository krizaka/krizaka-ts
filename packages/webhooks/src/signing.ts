import crypto from "node:crypto";

/**
 * The signature of a webhook: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (the scheme payment processors use, so a
 * receiver's code is the one everyone already knows). The timestamp is signed with the body: a captured request cannot be replayed
 * later than the tolerance.
 */
export const SIGNATURE_HEADER = "x-krizaka-signature";
export const EVENT_ID_HEADER = "x-krizaka-event-id";
export const EVENT_TYPE_HEADER = "x-krizaka-event";
// @fixed: how old a signed request may be, in seconds — a replay window, a security parameter
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const hmac = (secret: string, t: number, body: string) => crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

export function signBody(secret: string, body: string, atSeconds: number): string {
  return `t=${atSeconds},v1=${hmac(secret, atSeconds, body)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** Checks a signature header over the raw body: well-formed, not older than the tolerance (or from the future), and equal in constant time. Any of several `v1` values may match (a secret being rotated). */
export function verifySignature(secret: string, body: string, header: string | null | undefined, nowSeconds: number, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): VerifyResult {
  if (!header) return { ok: false, reason: "missing" };
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const candidates = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isInteger(t) || candidates.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: "stale" };
  const expected = Buffer.from(hmac(secret, t, body));
  const same = candidates.some((c) => c.length === expected.length && crypto.timingSafeEqual(Buffer.from(c), expected));
  return same ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** A new endpoint secret: shown once, kept sealed. */
export const newEndpointSecret = () => `whsec_${crypto.randomBytes(24).toString("base64url")}`;
