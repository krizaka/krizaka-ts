import type { Outbox } from "./outbox";
import { FAIL_STATE, type OutboxMessage, type Query } from "./port";

export interface DrainSummary {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
  /** Deliveries whose outcome could not be recorded because the lease had been lost to another worker. */
  lost: number;
}

export interface DrainOptions {
  outbox: Outbox;
  /** A pool-level query: each call is its own statement, never one long transaction, so a lease is all that holds a message. */
  query: Query;
  /** Who this worker is (a hostname and a process id): only the holder of a lease can complete or fail its message. */
  owner: string;
  /** Delivers one message: resolve on success, throw on failure. It must be idempotent on `message.id` (at-least-once). */
  deliver: (message: OutboxMessage) => Promise<void>;
  /** Only this topic; default every topic. */
  topic?: string;
}

/**
 * One round: leases a batch, delivers each message in order, records each outcome. Safe to run from several instances at once.
 * A delivery that throws is retried later (or is dead after `maxAttempts`); the round goes on with the next message.
 * @returns what happened
 */
export async function drainOnce(options: DrainOptions): Promise<DrainSummary> {
  const { outbox, query, owner, deliver, topic } = options;
  const summary: DrainSummary = { claimed: 0, delivered: 0, retried: 0, dead: 0, lost: 0 };
  const batch = await outbox.claim(query, { owner, ...(topic === undefined ? {} : { topic }) });
  summary.claimed = batch.length;
  for (const message of batch) {
    let failure: { error: unknown } | null = null;
    try {
      await deliver(message);
    } catch (error) {
      failure = { error };
    }
    if (failure === null) {
      if (await outbox.complete(query, message.id, owner)) summary.delivered += 1;
      else summary.lost += 1;
      continue;
    }
    const outcome = await outbox.fail(query, message.id, owner, failure.error);
    if (outcome.state === FAIL_STATE.retry) summary.retried += 1;
    else if (outcome.state === FAIL_STATE.dead) summary.dead += 1;
    else summary.lost += 1;
  }
  return summary;
}

export interface WorkerOptions extends DrainOptions {
  /** Waits this many seconds (a timer: the package has none of its own). */
  sleep: (seconds: number) => Promise<void>;
  /** The worker stops when this signal is aborted (checked between rounds). */
  signal?: AbortSignal;
  /** Seconds to wait when a round found nothing. Default 5. */
  idleSeconds?: number;
  /** Told of a round that threw (the store was unreachable): the loop waits and goes on. */
  onError?: (error: unknown) => void;
}

// @fixed: how long an idle worker waits before it looks again, a technical polling interval
const IDLE_SECONDS = 5;

/**
 * The loop a product starts (Next.js `instrumentation.ts`, a worker process): drain, and sleep when there was nothing. It has no
 * timer of its own — the product passes `sleep` — and it ends when the signal is aborted.
 */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const idle = options.idleSeconds ?? IDLE_SECONDS;
  while (!options.signal?.aborted) {
    let waited: boolean;
    try {
      waited = (await drainOnce(options)).claimed === 0;
    } catch (error) {
      options.onError?.(error);
      waited = true;
    }
    if (waited && !options.signal?.aborted) await options.sleep(idle);
  }
}
