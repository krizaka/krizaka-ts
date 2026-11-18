import type { ObjectRef, ScanResult } from "./malware-scanner";

/** What happened to an object, delivered at least once. */
export type ObjectEvent =
  | { type: "object.created"; ref: ObjectRef; size: number }
  | { type: "scan.result"; ref: ObjectRef; result: ScanResult };

export type ObjectEventHandler = (event: ObjectEvent) => Promise<void>;

/**
 * Where object events come from (a bucket notification queue, a webhook). Delivery is AT LEAST ONCE: a handler can see the same event
 * twice, so it is idempotent by `eventId` (type + key + version): wrap it with `idempotent`.
 */
export interface EventSource {
  /** Calls `handler` for each event; the returned function stops the subscription. */
  subscribe(handler: ObjectEventHandler): () => void;
}

/** The identity of an event: the same object version gives the same id, so a redelivery is recognised. */
export const eventId = (e: ObjectEvent) => JSON.stringify([e.type, e.ref.key, e.ref.version ?? ""]);

/** Wraps a handler so each `eventId` is handled once. `seen` is the ledger (a table in production); the id is marked after success. */
export function idempotent(
  handler: ObjectEventHandler,
  seen: { has(id: string): Promise<boolean>; add(id: string): Promise<void> },
): ObjectEventHandler {
  return async (event) => {
    const id = eventId(event);
    if (await seen.has(id)) return;
    await handler(event);
    await seen.add(id);
  };
}

/** An in-memory source for tests: `publish` delivers to every subscriber, `redeliver` times more (at-least-once). */
export function memoryEventSource(options: { redeliver?: number } = {}): EventSource & {
  publish(event: ObjectEvent): Promise<void>;
} {
  const handlers = new Set<ObjectEventHandler>();
  return {
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async publish(event) {
      for (let i = 0; i <= (options.redeliver ?? 0); i += 1) for (const h of handlers) await h(event);
    },
  };
}
