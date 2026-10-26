import { createHash } from "node:crypto";

import type { Query } from "@krizaka/db";

import { dbEventStore } from "./persistence";
import { type Clock, type EventStore, type PaymentEvent } from "./port";

export type { EventStore } from "./port";
export type { Query } from "@krizaka/db";

type Handlers = { [T in Exclude<PaymentEvent["type"], "ignored">]?: (event: Extract<PaymentEvent, { type: T }>) => Promise<void | "ignored"> };

/** Handlers that write through the transaction they are given, so their effect and the event's record commit together. */
export type TransactionHandlers = {
  [T in Exclude<PaymentEvent["type"], "ignored">]?: (event: Extract<PaymentEvent, { type: T }>, query: Query) => Promise<void | "ignored">;
};

/** Opens a transaction, runs the work with its `Query`, commits when the work returns and rolls back when it throws (`transaction` of `@krizaka/db` over the product's pool). */
export type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>;

export type Outcome = "applied" | "duplicate" | "ignored";

/** The handler of an event's type, or none (an `ignored` event, or a type the product does not handle). */
function handlerFor<H>(handlers: Partial<Record<string, H>>, event: PaymentEvent): H | undefined {
  return event.type === "ignored" ? undefined : handlers[event.type];
}

/**
 * Applies a verified event once: its id is recorded first, a replay runs no handler. An `ignored` event, or one the product
 * has no handler for, is not recorded. A handler may answer `"ignored"` (the event concerned no account of ours).
 * When the handler throws, the id is given back (`EventStore.forget`) and the error propagates: the webhook answers an error,
 * the processor retries, and the retry applies the event. A crash between the record and the effect can still lose an event;
 * `applyOnceInTransaction` closes that window, and is the way for anything that writes to the database.
 * @param store where applied ids are kept
 * @param event the verified, translated event
 * @param handlers one handler per event type the product applies
 * @returns `applied`, `duplicate` (already applied) or `ignored`
 * @throws whatever the handler throws, after the id was given back; an `AggregateError` of both errors (the handler's
 *   first) when giving the id back fails too, in which case the id stays recorded
 */
export async function applyOnce(store: EventStore, event: PaymentEvent, handlers: Handlers): Promise<Outcome> {
  const handler = handlerFor(handlers as Partial<Record<string, (e: PaymentEvent) => Promise<void | "ignored">>>, event);
  if (!handler) return "ignored";
  if (!(await store.markSeen(event.id, event.type))) return "duplicate";
  try {
    return (await handler(event)) === "ignored" ? "ignored" : "applied";
  } catch (error) {
    await giveBack(store, event.id, error);
    throw error;
  }
}

/** Gives the id back after a failed handler. If that fails too, both errors go to the caller, the handler's first. */
async function giveBack(store: EventStore, id: string, handlerError: unknown): Promise<void> {
  try {
    await store.forget?.(id);
  } catch (cleanupError) {
    throw new AggregateError([handlerError, cleanupError], `the handler of ${id} failed, and giving its id back failed too: the id stays recorded`, { cause: cleanupError });
  }
}

export interface ApplyOptions {
  /** Stamps the receipt time on the record. Without it the database's default does. */
  clock?: Clock;
  /** The Postgres schema and table of the record; default `payments.event`. A product that kept `public.payment_events` passes `{ schema: "public", table: "payment_events" }`. */
  table?: { schema: string; table: string };
}

/**
 * Applies a verified event once, recording its id and running its handler in **one transaction**: both commit together,
 * or both roll back when the handler throws (the processor's retry then applies it). The record is `payments.event`
 * (`dbEventStore`), written through the transaction's `Query`. An `ignored` event, or a type without handler, opens no transaction.
 * @param transaction the product's transaction runner (its pool's `BEGIN … COMMIT`)
 * @param event the verified, translated event
 * @param handlers one handler per event type, each writing through the `Query` it receives
 * @param options the clock and the record's table
 * @returns `applied`, `duplicate` (already applied) or `ignored`
 * @throws whatever the handler throws, after the transaction rolled back
 */
export async function applyOnceInTransaction(transaction: Transaction, event: PaymentEvent, handlers: TransactionHandlers, options: ApplyOptions = {}): Promise<Outcome> {
  const handler = handlerFor(handlers as Partial<Record<string, (e: PaymentEvent, query: Query) => Promise<void | "ignored">>>, event);
  if (!handler) return "ignored";
  return transaction(async (query) => {
    if (!(await dbEventStore(query, options.table).markSeen(event.id, event.type, options.clock?.now()))) return "duplicate";
    return (await handler(event, query)) === "ignored" ? "ignored" : "applied";
  });
}

/** What a payment event is announced as to the rest of the product: the outbox topic and the `evt.payment.<fact>.v1` routing keys. */
export const PAYMENT_TOPIC = "payments";
const TYPES = {
  payment_paid: "evt.payment.paid.v1",
  subscription_started: "evt.payment.subscription-started.v1",
  subscription_changed: "evt.payment.subscription-changed.v1",
  checkout_expired: "evt.payment.checkout-expired.v1",
  payment_refunded: "evt.payment.refunded.v1",
} as const;

/** The part of `@krizaka/outbox`'s `Outbox` this package needs: structural, so `payments` does not depend on `outbox`. */
export interface OutboxPort {
  append(tx: Query, message: { topic: string; type: string; payload: unknown; id?: string }): Promise<{ id: string; appended: boolean }>;
}

/** A stable UUID from the processor's event id: announcing the same event twice is one outbox message. */
export const messageIdOf = (eventId: string): string => {
  const h = createHash("sha256").update(`krizaka.payments:${eventId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};

/**
 * Announces a payment event through the outbox, INSIDE the handler's transaction: the announcement commits with the record of the
 * event and the product's own effect, and is delivered at least once after. An `ignored` event announces nothing.
 * @param tx the transaction `applyOnceInTransaction` gave the handler
 * @param outbox `createOutbox(...)` of `@krizaka/outbox`
 * @param event the verified event
 * @returns whether a message was appended (false for an `ignored` event or an event already announced)
 */
export async function announcePayment(tx: Query, outbox: OutboxPort, event: PaymentEvent): Promise<boolean> {
  if (event.type === "ignored") return false;
  const { type: _type, id, ...facts } = event;
  return (await outbox.append(tx, { topic: PAYMENT_TOPIC, type: TYPES[event.type], payload: { eventId: id, ...facts }, id: messageIdOf(id) })).appended;
}
