import crypto from "node:crypto";

import { PaymentsError, signPayload, verifySignature as verifyPayload } from "@krizaka/payments";

/**
 * The signature of a webhook: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (the scheme payment processors use, so a
 * receiver's code is the one everyone already knows). The timestamp is signed with the body: a captured request cannot be replayed
 * later than the tolerance.
 */
export const SIGNATURE_HEADER = "x-krizaka-signature";
export const EVENT_ID_HEADER = "x-krizaka-event-id";
export const EVENT_TYPE_HEADER = "x-krizaka-event";

/** Signing is `@krizaka/payments`' own (the same scheme, one implementation): this adds the header name and a verdict instead of a throw. */
export function signBody(secret: string, body: string, atSeconds: number): string {
  return signPayload(body, secret, atSeconds);
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** Checks a signature header over the raw body: well-formed, not older than the tolerance (or from the future), and equal in constant time. Any of several `v1` values may match (a secret being rotated). */
export function verifySignature(secret: string, body: string, header: string | null | undefined, nowSeconds: number): VerifyResult {
  if (!header) return { ok: false, reason: "missing" };
  try {
    verifyPayload(body, header, secret, nowSeconds);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof PaymentsError)) throw error;
    return { ok: false, reason: error.message.startsWith("Missing") ? "malformed" : error.message.startsWith("Timestamp") ? "stale" : "mismatch" };
  }
}

/** A new endpoint secret: shown once, kept sealed. */
export const newEndpointSecret = () => `whsec_${crypto.randomBytes(24).toString("base64url")}`;
