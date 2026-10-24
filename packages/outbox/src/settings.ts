import { integer, type Registry } from "@krizaka/settings";

/**
 * The settings of « outbox », a fragment the product adds to its registry: the admin sets how much a worker takes at once,
 * how long a claim lasts, how many tries a message gets and the first retry delay. Global scope only.
 */
export const outboxSettings = {
  // @fixed: a batch the worker delivers before it claims again; the admin chooses between 1 and 500.
  "outbox.batchSize": integer("outbox", 50, { min: 1, max: 500, unit: "messages" }),
  // @fixed: how long a claim is exclusive; a worker that dies lets it expire, and the message is delivered again.
  "outbox.leaseSeconds": integer("outbox", 60, { min: 10, max: 3600, unit: "seconds" }),
  // @fixed: tries before a message is a dead letter.
  "outbox.maxAttempts": integer("outbox", 8, { min: 1, max: 50, unit: "attempts" }),
  // @fixed: the first retry delay; it doubles at each failure, up to a cap.
  "outbox.backoffSeconds": integer("outbox", 30, { min: 1, max: 3600, unit: "seconds" }),
} as const satisfies Registry;

/** The four values, resolved by the product from its settings service (or `outboxDefaults`). */
export interface OutboxSettings {
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: number;
}

/** The registry defaults, as the worker's settings. */
export const outboxDefaults: OutboxSettings = {
  batchSize: outboxSettings["outbox.batchSize"].default,
  leaseSeconds: outboxSettings["outbox.leaseSeconds"].default,
  maxAttempts: outboxSettings["outbox.maxAttempts"].default,
  backoffSeconds: outboxSettings["outbox.backoffSeconds"].default,
};
