/**
 * The ports of « outbox »: a message written in the caller's transaction and delivered after the commit, AT LEAST ONCE. Generic:
 * no broker, no product import, no database client (a `Query` comes in), no wall clock (a `Clock` comes in).
 *
 * THE GUARANTEE. A claim is exclusive while its lease is valid. A worker that delivers and then crashes before `complete` lets the
 * lease expire, and the message is delivered AGAIN. So every consumer must be idempotent on the message id (see `consumeOnce`).
 * The outbox never promises « exactly once ».
 */
export type { Clock, Query } from "@krizaka/db";

/** What a product appends. */
export interface NewMessage {
  /** Where it goes: a worker claims one topic (`mail`, `recommender`, `webhooks`). Lower-case letters, digits, `_ . : -`. */
  topic: string;
  /** What happened, as a routing key (`evt.credit.granted.v1`): the Java kit's form. Lower-case letters, digits, `_ . -`. */
  type: string;
  /** The event's data: JSON. Never a secret, and as little personal data as the consumer needs. */
  payload: unknown;
  /** A stable id (a UUID) when the same fact can be appended twice: the second append is a no-op. Default: a fresh UUID. */
  id?: string;
  /** Not before this instant (a scheduled delivery). Default: now. */
  availableAt?: Date;
}

/** The envelope a worker receives: the Java kit's `id`, `type`, `occurredAt`, `payload`, and where it is in its attempts. */
export interface OutboxMessage {
  id: string;
  topic: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
  /** How many deliveries have been started for it, this one included. */
  attempts: number;
}

/** The knobs of the outbox, read from the admin's settings (`@krizaka/outbox/settings`). */
export interface OutboxSettings {
  /** Messages a worker claims at once. */
  batchSize: number;
  /** Seconds a claim holds a message before another worker may take it. Longer than the slowest delivery. */
  leaseSeconds: number;
  /** Deliveries started before a message is dead. */
  maxAttempts: number;
  /** Seconds before the second attempt; it doubles with each attempt. */
  backoffSeconds: number;
  /** The most seconds a retry waits. */
  backoffMaxSeconds: number;
  /** Days a delivered or dead message is kept before `purge`. */
  retentionDays: number;
}

/** What `claim` takes. */
export interface ClaimOptions {
  /** Only this topic; default every topic. */
  topic?: string;
  /** Who claims: a worker's id, so that only the holder of a lease can complete or fail the message. */
  owner: string;
}

/** What became of a failed delivery. */
export const FAIL_STATE = { retry: "retry", dead: "dead", lost: "lost" } as const;

/** The result of `fail`: the message will be retried, is dead, or was not this worker's any more. */
export type FailOutcome =
  | { state: typeof FAIL_STATE.retry; availableAt: Date }
  | { state: typeof FAIL_STATE.dead }
  | { state: typeof FAIL_STATE.lost };

export interface OutboxStats {
  /** Waiting for a worker (including retries). */
  pending: number;
  /** Held by a worker right now. */
  leased: number;
  delivered: number;
  dead: number;
}

/** Where the messages live. Every adapter runs `outboxStoreContract` (`@krizaka/outbox/testkit`). Times come from the caller. */
export interface OutboxStore {
  /** Writes the message. A second append of the same id writes nothing and answers `false`. */
  append(message: {
    id: string;
    topic: string;
    type: string;
    payload: unknown;
    createdAt: Date;
    availableAt: Date;
  }): Promise<boolean>;
  /** First marks dead the messages whose last attempt's lease expired with no answer, then leases up to `limit` due messages. */
  claim(
    options: ClaimOptions & { limit: number; leaseSeconds: number; maxAttempts: number; now: Date },
  ): Promise<OutboxMessage[]>;
  /** Marks it delivered, when `owner` still holds it. `false` when the lease was lost: the other worker delivers. */
  complete(id: string, owner: string, now: Date): Promise<boolean>;
  /** Records the failure: back off, or dead after `maxAttempts`. */
  fail(
    id: string,
    owner: string,
    error: string,
    options: { now: Date; maxAttempts: number; backoffSeconds: number; backoffMaxSeconds: number },
  ): Promise<FailOutcome>;
  /** Gives a dead message another life: no attempts, due now. `false` when it is not dead. */
  retryDead(id: string, now: Date): Promise<boolean>;
  /** Removes the delivered and dead messages older than `before`. Returns how many. */
  purgeBefore(before: Date): Promise<number>;
  stats(now: Date): Promise<OutboxStats>;
}

export const OUTBOX_CODE = {
  badTopic: "OUTBOX_BAD_TOPIC",
  badType: "OUTBOX_BAD_TYPE",
  badId: "OUTBOX_BAD_ID",
  badPayload: "OUTBOX_BAD_PAYLOAD",
  badSettings: "OUTBOX_BAD_SETTINGS",
} as const;
export type OutboxCode = (typeof OUTBOX_CODE)[keyof typeof OUTBOX_CODE];

export class OutboxError extends Error {
  constructor(
    readonly code: OutboxCode,
    message: string,
  ) {
    super(message);
    this.name = "OutboxError";
  }
}
