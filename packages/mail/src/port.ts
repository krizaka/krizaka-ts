/**
 * The ports of « mail »: a message queued in the caller's transaction and delivered after the commit, once per idempotency key,
 * never to a suppressed address. Generic: no vendor SDK (providers are adapters over an injected `fetch`), no environment variable
 * (keys come in as parameters), no wall clock, no database client. The module takes mail ALREADY RENDERED: templates are
 * `@krizaka/email`'s (a UI package this one never imports), and its three ports are satisfied structurally by `emailPorts`.
 */
export type { Clock, Query } from "@krizaka/db";

/** Why an address is never mailed again. The same values as `@krizaka/email`'s `SuppressionReason`. */
export const SUPPRESSION_REASON = { bounce: "bounce", complaint: "complaint", unsubscribed: "unsubscribed" } as const;
export type SuppressionReason = (typeof SUPPRESSION_REASON)[keyof typeof SUPPRESSION_REASON];

/** The mail a product queues. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** What kind of mail it is (`transactional`, `notification`, `digest`…): lower-case token, kept in the delivery log. */
  category: string;
  /** The template that rendered it, for the log (never the body). */
  template: string;
  locale: string;
  /** One key sends once: queueing it twice is one message, and delivering it twice sends one mail. */
  idempotencyKey: string;
  /** Overrides `mail.replyTo` for this message. */
  replyTo?: string;
}

/** A mail the provider receives: the message with the sender the settings give. */
export interface OutgoingMail extends MailMessage {
  from: string;
}

/** What the provider answered. */
export interface Sent {
  messageId: string | null;
}

/** One provider of mail (an adapter over `fetch`). It resolves on acceptance and throws on any failure: the outbox retries. */
export interface MailProvider {
  readonly name: string;
  send(mail: OutgoingMail): Promise<Sent>;
}

export const DELIVERY_STATUS = {
  sent: "sent",
  failed: "failed",
  suppressed: "suppressed",
  duplicate: "duplicate",
} as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

/** One line of the delivery log: what, to whom (a hash, never the address), how it went. The shape of `@krizaka/email`'s `DeliveryLogEntry`. */
export interface DeliveryEntry {
  at?: string;
  template: string;
  category: string;
  locale: string;
  to: string;
  status: DeliveryStatus;
  messageId?: string | undefined;
  idempotencyKey?: string | undefined;
  detail?: string | undefined;
}

/** A line to write: the instant is a `Date`. */
export type DeliveryInput = Omit<DeliveryEntry, "at"> & { at: Date };

/** A line as read back. */
export interface DeliveryRecord extends DeliveryEntry {
  id: number;
  at: string;
}

/** Where the module keeps its state. Every adapter runs `mailStoreContract` (`@krizaka/mail/testkit`). Addresses arrive hashed. */
export interface MailStore {
  record(entry: DeliveryInput): Promise<void>;
  recent(limit: number): Promise<DeliveryRecord[]>;
  isSuppressed(addressHash: string): Promise<boolean>;
  /** `false` when the address was already suppressed (the first reason stays). */
  suppress(addressHash: string, reason: SuppressionReason, now: Date): Promise<boolean>;
  /** Lifts a suppression (the person re-subscribed, or it was a mistake). */
  unsuppress(addressHash: string): Promise<boolean>;
  hasKey(key: string): Promise<boolean>;
  /** `true` the first time a key is claimed. */
  claimKey(key: string, now: Date): Promise<boolean>;
  releaseKey(key: string): Promise<void>;
  /** Removes the keys and log lines older than `before` (suppressions are kept for good). Returns how many. */
  purgeBefore(before: Date): Promise<number>;
}

export interface MailSettings {
  provider: "log" | "mailgun" | "resend";
  /** The sender, `Name <address>` or an address. */
  from: string;
  /** Where replies go; empty for none. */
  replyTo: string;
  /** Days the delivery log and the idempotency keys are kept. */
  retentionDays: number;
}

export const MAIL_CODE = {
  badAddress: "MAIL_BAD_ADDRESS",
  badMessage: "MAIL_BAD_MESSAGE",
  badSettings: "MAIL_BAD_SETTINGS",
  provider: "MAIL_PROVIDER_FAILED",
  badWebhook: "MAIL_BAD_WEBHOOK",
} as const;
export type MailCode = (typeof MAIL_CODE)[keyof typeof MAIL_CODE];

export class MailError extends Error {
  constructor(
    readonly code: MailCode,
    message: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}
