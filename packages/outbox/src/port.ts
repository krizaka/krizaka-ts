/**
 * The ports of « outbox »: events written in the caller's transaction, delivered at least once. Generic: no product import,
 * no database client (a `Query` comes in), no wall clock (a `Clock` comes in), no timer (a `sleep` comes in).
 * The guarantee is AT LEAST ONCE: after a crash a message is delivered again, so a consumer is idempotent on the message id.
 */
export type { Clock, Query } from "@krizaka/db";

/** What a product appends. `id` makes the append idempotent (an id already present is left as it is). */
export interface OutboxInput {
  topic: string;
  /** The event type, named `evt.<module>.<fact>.v1`. */
  type: string;
  payload: Record<string, unknown>;
  id?: string;
}

/** A message as read back: the envelope (id, type, occurredAt, payload) and its delivery state. */
export interface OutboxMessage {
  id: string;
  topic: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  availableAt: Date;
  /** How many times the message was claimed. */
  attempts: number;
  leasedUntil: Date | null;
  leaseOwner: string | null;
  deliveredAt: Date | null;
  deadAt: Date | null;
  lastError: string | null;
}

/** What a store writes for an append: the input with its id and time. */
export interface OutboxInsert {
  id: string | null;
  topic: string;
  type: string;
  payload: Record<string, unknown>;
  at: Date;
}

export interface ClaimOptions {
  topic?: string;
  limit: number;
  leaseSeconds: number;
  owner: string;
}

/** What a store needs to claim: the options, the time, and the attempts after which an unanswered claim is dead. */
export interface StoreClaim extends ClaimOptions {
  now: Date;
  maxAttempts: number;
}

/** What a store needs to fail a message: the error, the time and the retry policy. */
export interface StoreFail {
  id: string;
  owner: string;
  error: string;
  now: Date;
  maxAttempts: number;
  backoffSeconds: number;
  maxBackoffSeconds: number;
}

/** What became of a failed message: scheduled again, buried, or not ours any more (its lease went to another worker). */
export type FailOutcome = "retry" | "dead" | "lost";

/** Where the messages live. Every adapter runs `outboxStoreContract` (`@krizaka/outbox/testkit`). */
export interface OutboxStore {
  /** Writes a message; returns its id. An id already present is a no-op. */
  append(message: OutboxInsert): Promise<string>;
  /** Leases up to `limit` due messages to `owner`, exclusively while the lease is valid; each claim counts as an attempt. */
  claim(options: StoreClaim): Promise<OutboxMessage[]>;
  /** Marks a message delivered, if `owner` still holds it. Returns whether it did. */
  complete(id: string, owner: string, now: Date): Promise<boolean>;
  fail(options: StoreFail): Promise<FailOutcome>;
  get(id: string): Promise<OutboxMessage | null>;
  /** The dead letters, newest first. */
  listDead(options: { topic?: string; limit: number }): Promise<OutboxMessage[]>;
  /** Puts a dead letter back in line: attempts reset, due at `now`. Returns whether it was dead. */
  requeue(id: string, now: Date): Promise<boolean>;
}

export const OUTBOX_CODE = {
  badMessage: "OUTBOX_BAD_MESSAGE",
  badClaim: "OUTBOX_BAD_CLAIM",
  badSettings: "OUTBOX_BAD_SETTINGS",
} as const;
export type OutboxCode = (typeof OUTBOX_CODE)[keyof typeof OUTBOX_CODE];

export class OutboxError extends Error {
  constructor(
    readonly code: OutboxCode,
    readonly value: string,
  ) {
    super(`${code}: ${value}`);
    this.name = "OutboxError";
  }
}
