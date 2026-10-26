import { randomUUID } from "node:crypto";

import { ident } from "@krizaka/db";
import { subHours } from "@krizaka/time";

import { dbOutboxStore } from "./persistence";
import { type ClaimOptions, type Clock, type FailOutcome, type NewMessage, type OutboxMessage, type OutboxSettings, type OutboxStats, type OutboxStore, type Query } from "./port";
import { checkMessage, checkSettings } from "./rules";

export interface OutboxDeps {
  clock: Clock;
  /** The settings, read at each call so the admin's change applies at once: an object, or a function over the settings service. */
  settings: OutboxSettings | (() => OutboxSettings | Promise<OutboxSettings>);
  /** The store over a query (a pool or a transaction). Default: the PostgreSQL store on schema `outbox`. */
  storeFor?: (query: Query) => OutboxStore;
  /** The Postgres schema, when the product renamed the module's (used by the default store). */
  schema?: string;
}

/** The outbox as a product uses it. Every function takes the `Query` it works through: pass `tx` to join a unit of work. */
export interface Outbox {
  /** Appends a message INSIDE the caller's transaction: it commits or rolls back with it. Answers its id, and `false` when that id was already appended. */
  append(tx: Query, message: NewMessage): Promise<{ id: string; appended: boolean }>;
  /** Leases a batch of due messages to `owner`. Exclusive while each lease is valid. */
  claim(query: Query, options: ClaimOptions & { limit?: number; leaseSeconds?: number }): Promise<OutboxMessage[]>;
  /** The delivery succeeded. `false` when the lease was lost to another worker. */
  complete(query: Query, id: string, owner: string): Promise<boolean>;
  /** The delivery failed: back off (doubling, capped), or dead after `maxAttempts`. */
  fail(query: Query, id: string, owner: string, error: unknown): Promise<FailOutcome>;
  /** A dead message gets another life, due now. */
  retryDead(query: Query, id: string): Promise<boolean>;
  /** Removes delivered and dead messages older than the retention. Returns how many. */
  purge(query: Query): Promise<number>;
  stats(query: Query): Promise<OutboxStats>;
}

const MAX_ERROR = 1000;
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, MAX_ERROR);

/**
 * The outbox of a product.
 * @param deps the clock, the settings, and optionally the store and schema
 * @returns the outbox's functions
 */
export function createOutbox(deps: OutboxDeps): Outbox {
  const schema = ident(deps.schema ?? "outbox");
  const storeFor = deps.storeFor ?? ((query: Query) => dbOutboxStore(query, schema));
  const settings = async () => checkSettings(typeof deps.settings === "function" ? await deps.settings() : deps.settings);
  return {
    async append(tx, message) {
      checkMessage(message);
      const now = deps.clock.now();
      const id = message.id ?? randomUUID();
      const appended = await storeFor(tx).append({ id, topic: message.topic, type: message.type, payload: message.payload, createdAt: now, availableAt: message.availableAt ?? now });
      return { id, appended };
    },
    async claim(query, options) {
      const s = await settings();
      return storeFor(query).claim({ ...options, limit: options.limit ?? s.batchSize, leaseSeconds: options.leaseSeconds ?? s.leaseSeconds, maxAttempts: s.maxAttempts, now: deps.clock.now() });
    },
    complete: (query, id, owner) => storeFor(query).complete(id, owner, deps.clock.now()),
    async fail(query, id, owner, error) {
      const s = await settings();
      return storeFor(query).fail(id, owner, describe(error), { now: deps.clock.now(), maxAttempts: s.maxAttempts, backoffSeconds: s.backoffSeconds, backoffMaxSeconds: s.backoffMaxSeconds });
    },
    retryDead: (query, id) => storeFor(query).retryDead(id, deps.clock.now()),
    async purge(query) {
      const s = await settings();
      return storeFor(query).purgeBefore(subHours(deps.clock.now(), s.retentionDays * 24));
    },
    stats: (query) => storeFor(query).stats(deps.clock.now()),
  };
}
