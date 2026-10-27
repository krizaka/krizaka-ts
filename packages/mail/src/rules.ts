import { createHash } from "node:crypto";

import { MAIL_CODE, MailError, type MailMessage, type MailSettings } from "./port";

export const MAIL_BOUNDS = { retentionDays: [1, 3650] } as const;
export const MAIL_DEFAULTS: MailSettings = { provider: "log", from: "Krizaka <no-reply@krizaka.com>", replyTo: "", retentionDays: 90 };

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TOKEN = /^[a-z][a-z0-9_.-]{0,39}$/;
// @fixed: RFC 5321's longest forward path
const MAX_ADDRESS = 254;
// @fixed: a subject is one short line; a body past this is not a transactional mail
const MAX_SUBJECT = 200;
const MAX_BODY = 500_000;
const MAX_KEY = 200;

export const normalizeAddress = (email: string) => email.trim().toLowerCase();

/** The full SHA-256 of an address: suppressions and the log never hold the address itself (Loi 25). */
export const hashAddress = (email: string) => createHash("sha256").update(normalizeAddress(email)).digest("hex");

/** A stable UUID (version 5 shaped) from a seed: the same key queued twice is one outbox message. */
export function uuidOf(seed: string): string {
  const h = createHash("sha256").update(`krizaka.mail:${seed}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** The bare address of `Name <address>` or `address`. */
export function bareAddress(from: string): string {
  const match = /<([^<>]+)>\s*$/.exec(from);
  return (match?.[1] ?? from).trim();
}

const oneLine = (value: string) => !/[\r\n]/.test(value);

/** @throws MailError when the address is not one mailbox on one line (no header injection). */
export function checkAddress(address: string, what = "address"): void {
  if (typeof address !== "string" || address.length > MAX_ADDRESS || !oneLine(address) || !ADDRESS.test(bareAddress(address))) throw new MailError(MAIL_CODE.badAddress, `${what} is not a valid address`);
}

/** @throws MailError on the first thing wrong with a message. */
export function checkMessage(message: MailMessage): void {
  checkAddress(message.to, "to");
  if (message.replyTo !== undefined && message.replyTo !== "") checkAddress(message.replyTo, "replyTo");
  if (typeof message.subject !== "string" || message.subject.trim() === "" || message.subject.length > MAX_SUBJECT || !oneLine(message.subject)) throw new MailError(MAIL_CODE.badMessage, "subject must be one line of 1 to 200 characters");
  if (typeof message.text !== "string" || message.text.trim() === "" || message.text.length > MAX_BODY) throw new MailError(MAIL_CODE.badMessage, "text is required");
  if (message.html !== undefined && (typeof message.html !== "string" || message.html.length > MAX_BODY)) throw new MailError(MAIL_CODE.badMessage, "html is too long");
  if (!TOKEN.test(message.category) || !TOKEN.test(message.template)) throw new MailError(MAIL_CODE.badMessage, "category and template are lower-case tokens");
  if (typeof message.locale !== "string" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(message.locale)) throw new MailError(MAIL_CODE.badMessage, "locale is a language tag like fr or en-CA");
  if (typeof message.idempotencyKey !== "string" || message.idempotencyKey === "" || message.idempotencyKey.length > MAX_KEY) throw new MailError(MAIL_CODE.badMessage, "idempotencyKey is required (1 to 200 characters)");
}

/** @throws MailError when the settings are out of bounds. */
export function checkSettings(s: MailSettings): MailSettings {
  const [min, max] = MAIL_BOUNDS.retentionDays;
  if (!Number.isInteger(s.retentionDays) || s.retentionDays < min || s.retentionDays > max) throw new MailError(MAIL_CODE.badSettings, `retentionDays must be ${min} to ${max}`);
  checkAddress(s.from, "from");
  if (s.replyTo !== "") checkAddress(s.replyTo, "replyTo");
  return s;
}
