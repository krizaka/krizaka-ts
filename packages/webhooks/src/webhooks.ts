import crypto from "node:crypto";

import type { Query } from "@krizaka/db";
import { addSeconds } from "date-fns";

import { EVENT_ID_HEADER, EVENT_TYPE_HEADER, newEndpointSecret, SIGNATURE_HEADER, signBody, type VerifyResult,verifySignature } from "./signing";
import { endpointUrlProblem } from "./url";

/** A SQL executor: `@krizaka/db`'s `Query`, which the product passes (its pool, or its transaction's client). */
export type { Query };

// @fixed: how long a claimed delivery is held by its worker before another may take it, in seconds
const LEASE_SECONDS = 60;

export const WEBHOOK_CODE = {
  url: "WEBHOOK_URL",
  events: "WEBHOOK_EVENTS",
  limit: "WEBHOOK_LIMIT",
  notFound: "WEBHOOK_NOT_FOUND",
  signature: "WEBHOOK_SIGNATURE",
} as const;
export type WebhookCode = (typeof WEBHOOK_CODE)[keyof typeof WEBHOOK_CODE];

export class WebhookError extends Error {
  constructor(
    readonly code: WebhookCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "WebhookError";
  }
}

export interface WebhookRules {
  /** The events the product emits (`booking.created`, `invoice.paid`): an endpoint subscribes to some of them. */
  events: readonly string[];
  /** Tries before a delivery is given up (the first one included). */
  maxAttempts: number;
  /** Seconds to wait after the 1st, 2nd… failure; the last value repeats. */
  backoffSeconds: readonly number[];
}

export interface WebhookDeps {
  query: Query;
  rules: WebhookRules;
  /** Keeps the endpoint secret at rest (the product's own sealing); without it the secret is stored as is. */
  secrets?: { seal: (plain: string) => string; open: (sealed: string) => string };
  newId?: () => string;
}

export interface EndpointView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
}

export interface OutgoingRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** The product's HTTP call: no redirects, a short timeout, and it refuses to connect to a private address. Resolves with the status; throws when it could not connect. */
export type Send = (request: OutgoingRequest) => Promise<{ status: number }>;

export interface DeliveryView {
  id: string;
  eventId: string;
  eventType: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

interface EndpointRow {
  id: string;
  owner_id: string;
  url: string;
  secret_sealed: string;
  events: string[];
  active: boolean;
  created_at: Date;
}
const view = (r: EndpointRow): EndpointView => ({ id: r.id, url: r.url, events: r.events, active: r.active, createdAt: r.created_at });

/** Outgoing webhooks over the product's PostgreSQL (see `webhooksMigration`): endpoints, one queued delivery per endpoint and event, signed retries, a log. */
export function createWebhooks(deps: WebhookDeps) {
  const { query, rules } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const seal = deps.secrets?.seal ?? ((s: string) => s);
  const open = deps.secrets?.open ?? ((s: string) => s);

  function checkEvents(events: readonly string[]) {
    if (events.length === 0 || events.some((e) => !rules.events.includes(e))) throw new WebhookError(WEBHOOK_CODE.events);
  }
  function checkUrl(url: string) {
    const problem = endpointUrlProblem(url);
    if (problem || url.length > 500) throw new WebhookError(WEBHOOK_CODE.url, problem ?? "TOO_LONG");
  }
  async function owned(owner: string, id: string): Promise<EndpointRow> {
    const [row] = await query<EndpointRow>("SELECT * FROM webhook_endpoints WHERE id = $1 AND owner_id = $2", [id, owner]);
    if (!row) throw new WebhookError(WEBHOOK_CODE.notFound);
    return row;
  }

  return {
    /** Registers an endpoint: the secret is in the answer once, the product keeps it sealed. */
    async registerEndpoint(owner: string, input: { url: string; events: readonly string[] }, options: { maxEndpoints: number }, now: Date): Promise<{ endpoint: EndpointView; secret: string }> {
      checkUrl(input.url);
      checkEvents(input.events);
      const [{ n } = { n: 0 }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM webhook_endpoints WHERE owner_id = $1", [owner]);
      if (n >= options.maxEndpoints) throw new WebhookError(WEBHOOK_CODE.limit);
      const secret = newEndpointSecret();
      const [row] = await query<EndpointRow>("INSERT INTO webhook_endpoints (id, owner_id, url, secret_sealed, events, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [newId(), owner, input.url, seal(secret), [...new Set(input.events)], now]);
      return { endpoint: view(row!), secret };
    },

    async listEndpoints(owner: string): Promise<EndpointView[]> {
      return (await query<EndpointRow>("SELECT * FROM webhook_endpoints WHERE owner_id = $1 ORDER BY created_at", [owner])).map(view);
    },

    async updateEndpoint(owner: string, id: string, patch: { events?: readonly string[]; active?: boolean }): Promise<EndpointView> {
      const row = await owned(owner, id);
      if (patch.events) checkEvents(patch.events);
      const [next] = await query<EndpointRow>("UPDATE webhook_endpoints SET events = $2, active = $3, disabled_why = CASE WHEN $3 THEN NULL ELSE disabled_why END WHERE id = $1 RETURNING *", [id, patch.events ? [...new Set(patch.events)] : row.events, patch.active ?? row.active]);
      return view(next!);
    },

    async removeEndpoint(owner: string, id: string): Promise<void> {
      await owned(owner, id);
      await query("DELETE FROM webhook_endpoints WHERE id = $1", [id]);
    },

    /** A new secret (the old one stops signing at once): in the answer once. */
    async rotateSecret(owner: string, id: string): Promise<{ secret: string }> {
      await owned(owner, id);
      const secret = newEndpointSecret();
      await query("UPDATE webhook_endpoints SET secret_sealed = $2 WHERE id = $1", [id, seal(secret)]);
      return { secret };
    },

    /** Queues an event for every active endpoint of the owner that subscribed to it. The same `event.id` is queued once per endpoint, however many times it is emitted. Returns how many were queued now. */
    async emit(owner: string, event: { id: string; type: string; payload: unknown }, now: Date): Promise<number> {
      if (!rules.events.includes(event.type)) throw new WebhookError(WEBHOOK_CODE.events, event.type);
      const rows = await query(
        `INSERT INTO webhook_deliveries (id, endpoint_id, event_id, event_type, payload, next_attempt_at, created_at)
         SELECT gen_random_uuid(), e.id, $2, $3, $4, $5, $5 FROM webhook_endpoints e WHERE e.owner_id = $1 AND e.active AND $3 = ANY (e.events)
         ON CONFLICT (endpoint_id, event_id) DO NOTHING RETURNING id`,
        [owner, event.id, event.type, JSON.stringify(event.payload ?? null), now],
      );
      return rows.length;
    },

    /** Sends what is due, signed; a 2xx is delivered, anything else retries after the backoff until `maxAttempts`, then it is given up (and stays in the log). */
    async deliverDue(now: Date, send: Send, options: { limit?: number } = {}): Promise<{ delivered: number; retried: number; failed: number }> {
      // Claimed by a lease: the rows are pushed out a minute in one statement, so two workers never send the same delivery at once.
      const due = await query<{ id: string; endpoint_id: string; event_id: string; event_type: string; payload: unknown; attempts: number; url: string; secret_sealed: string }>(
        `WITH c AS (SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
                     WHERE d.status = 'pending' AND d.next_attempt_at <= $1 AND e.active ORDER BY d.next_attempt_at LIMIT $2 FOR UPDATE OF d SKIP LOCKED)
         UPDATE webhook_deliveries d SET next_attempt_at = $3 FROM c, webhook_endpoints e WHERE d.id = c.id AND e.id = d.endpoint_id
         RETURNING d.id, d.endpoint_id, d.event_id, d.event_type, d.payload, d.attempts, e.url, e.secret_sealed`,
        [now, options.limit ?? 20, addSeconds(now, LEASE_SECONDS)],
      );
      const out = { delivered: 0, retried: 0, failed: 0 };
      for (const d of due) {
        const body = JSON.stringify({ id: d.event_id, type: d.event_type, created: Math.floor(now.getTime() / 1000), data: d.payload });
        let status: number | null = null;
        let error: string | null = null;
        try {
          status = (await send({ url: d.url, body, headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signBody(open(d.secret_sealed), body, Math.floor(now.getTime() / 1000)), [EVENT_ID_HEADER]: d.event_id, [EVENT_TYPE_HEADER]: d.event_type } })).status;
        } catch (e) {
          error = (e instanceof Error ? e.message : "send failed").slice(0, 300);
        }
        const attempts = d.attempts + 1;
        if (status !== null && status >= 200 && status < 300) {
          await query("UPDATE webhook_deliveries SET status = 'delivered', attempts = $2, last_status = $3, last_error = NULL, delivered_at = $4 WHERE id = $1", [d.id, attempts, status, now]);
          out.delivered++;
        } else if (attempts >= rules.maxAttempts) {
          await query("UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_status = $3, last_error = $4 WHERE id = $1", [d.id, attempts, status, error ?? `HTTP ${status}`]);
          out.failed++;
        } else {
          const wait = rules.backoffSeconds[Math.min(attempts - 1, rules.backoffSeconds.length - 1)] ?? 60;
          await query("UPDATE webhook_deliveries SET attempts = $2, last_status = $3, last_error = $4, next_attempt_at = $5 WHERE id = $1", [d.id, attempts, status, error ?? `HTTP ${status}`, addSeconds(now, wait)]);
          out.retried++;
        }
      }
      return out;
    },

    /** The recent deliveries of one endpoint (the owner's own), newest first: what was sent, how it went. */
    async deliveries(owner: string, endpointId: string, limit = 50): Promise<DeliveryView[]> {
      await owned(owner, endpointId);
      const rows = await query<{ id: string; event_id: string; event_type: string; status: DeliveryView["status"]; attempts: number; last_status: number | null; last_error: string | null; created_at: Date; delivered_at: Date | null }>(
        "SELECT id, event_id, event_type, status, attempts, last_status, last_error, created_at, delivered_at FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC LIMIT $2",
        [endpointId, limit],
      );
      return rows.map((r) => ({ id: r.id, eventId: r.event_id, eventType: r.event_type, status: r.status, attempts: r.attempts, lastStatus: r.last_status, lastError: r.last_error, createdAt: r.created_at, deliveredAt: r.delivered_at }));
    },
  };
}
export type Webhooks = ReturnType<typeof createWebhooks>;

/**
 * An incoming webhook, applied exactly once: the signature is checked over the RAW body (a bad one is `WEBHOOK_SIGNATURE`), the event id
 * is recorded first (a replay is `"duplicate"` and changes nothing), then `apply` runs; if it throws, the record is removed so the sender's
 * retry applies it.
 */
export async function receiveWebhook(deps: { query: Query }, input: { source: string; secret: string; rawBody: string; signature: string | null | undefined; eventId: string; now: Date }, apply: () => Promise<void>): Promise<"applied" | "duplicate"> {
  const checked: VerifyResult = verifySignature(input.secret, input.rawBody, input.signature, Math.floor(input.now.getTime() / 1000));
  if (!checked.ok) throw new WebhookError(WEBHOOK_CODE.signature, checked.reason);
  const rows = await deps.query("INSERT INTO webhook_received (source, event_id, received_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING event_id", [input.source, input.eventId, input.now]);
  if (rows.length === 0) return "duplicate";
  try {
    await apply();
  } catch (error) {
    await deps.query("DELETE FROM webhook_received WHERE source = $1 AND event_id = $2", [input.source, input.eventId]);
    throw error;
  }
  return "applied";
}
