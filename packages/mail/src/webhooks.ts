import { createHmac, timingSafeEqual } from "node:crypto";

import { MAIL_CODE, MailError, SUPPRESSION_REASON, type SuppressionReason } from "./port";

/** What a provider's webhook tells us about one address. */
export interface Suppression {
  address: string;
  reason: SuppressionReason;
}

// @fixed: how far a webhook's timestamp may be from now, in seconds (replay protection; the providers' own recommendation is minutes)
const TOLERANCE_SECONDS = 300;

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const bad = (why: string) => new MailError(MAIL_CODE.badWebhook, why);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * A Mailgun webhook (JSON body): checks the signature (HMAC-SHA256 of `timestamp + token` with the webhook signing key, hex) and
 * its age, then answers the address to suppress, or `null` for an event that is not a permanent bounce, a complaint or an unsubscribe.
 * @throws MailError when the body is not Mailgun's, the signature is wrong or the timestamp is stale
 */
export function parseMailgunWebhook(rawBody: string, signingKey: string, nowSeconds: number): Suppression | null {
  let body: Record<string, unknown>;
  try {
    body = record(JSON.parse(rawBody));
  } catch {
    throw bad("the body is not JSON");
  }
  const sig = record(body.signature);
  const timestamp = text(sig.timestamp);
  const expected = createHmac("sha256", signingKey)
    .update(timestamp + text(sig.token))
    .digest("hex");
  if (!equal(expected, text(sig.signature))) throw bad("the signature does not match");
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS)
    throw bad("the timestamp is stale");
  const data = record(body["event-data"]);
  const address = text(data.recipient);
  if (address === "") return null;
  const event = text(data.event);
  if (event === "complained") return { address, reason: SUPPRESSION_REASON.complaint };
  if (event === "unsubscribed") return { address, reason: SUPPRESSION_REASON.unsubscribed };
  if (event === "failed" && text(data.severity) === "permanent") return { address, reason: SUPPRESSION_REASON.bounce };
  return null;
}

export interface SvixHeaders {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
}

/**
 * A Resend webhook (signed the Svix way): HMAC-SHA256 over `id.timestamp.body` with the base64 secret that follows `whsec_`, any of
 * the space-separated `v1,<base64>` signatures matching. Answers the addresses to suppress (a hard bounce or a complaint).
 * @throws MailError when the headers are missing, the signature is wrong or the timestamp is stale
 */
export function parseResendWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  nowSeconds: number,
): Suppression[] {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw bad("the signature headers are missing");
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS)
    throw bad("the timestamp is stale");
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const ok = signature.split(" ").some((part) => part.startsWith("v1,") && equal(part.slice(3), expected));
  if (!ok) throw bad("the signature does not match");
  let event: Record<string, unknown>;
  try {
    event = record(JSON.parse(rawBody));
  } catch {
    throw bad("the body is not JSON");
  }
  const data = record(event.data);
  const to = Array.isArray(data.to) ? data.to.filter((a): a is string => typeof a === "string") : [];
  const type = text(event.type);
  if (type === "email.complained") return to.map((address) => ({ address, reason: SUPPRESSION_REASON.complaint }));
  if (type === "email.bounced" && text(record(data.bounce).type).toLowerCase() !== "transient")
    return to.map((address) => ({ address, reason: SUPPRESSION_REASON.bounce }));
  return [];
}
