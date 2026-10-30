import { differenceInSeconds } from "@krizaka/time";

import type { ConnectEvent, ConnectHandlers } from "./connect";
import { accountStatusOf } from "./connect-stripe";
import type { Clock, EventStore } from "./port";
import { PAYMENTS_CODE, PaymentsError } from "./port";
import { DEFAULT_TOLERANCE_SECONDS, verifySignature } from "./webhook";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the processor's untyped JSON, narrowed below

/** A notification of the ONE platform Connect endpoint: routed by its `account`. A notification without one is the platform's own: ignored. */
export function translateConnect(event: {
  id: string;
  type: string;
  account?: string;
  data: { object: Obj };
}): ConnectEvent {
  const accountId = typeof event.account === "string" && event.account !== "" ? event.account : null;
  if (!accountId) return { id: event.id, type: "ignored" };
  const o = event.data.object;
  const metadata = { ...(o.metadata as Record<string, string> | undefined) };
  switch (event.type) {
    case "account.updated":
      return { id: event.id, type: "account_updated", accountId, status: accountStatusOf({ ...o, id: accountId }) };
    case "payment_intent.succeeded":
      return {
        id: event.id,
        type: "payment_paid",
        accountId,
        paymentRef: String(o.id),
        amountMinor: Number(o.amount_received ?? o.amount),
        currency: String(o.currency),
        metadata,
      };
    case "payment_intent.amount_capturable_updated":
      return {
        id: event.id,
        type: "payment_held",
        accountId,
        paymentRef: String(o.id),
        amountMinor: Number(o.amount_capturable ?? o.amount),
        currency: String(o.currency),
        metadata,
      };
    case "payment_intent.canceled":
      return { id: event.id, type: "payment_released", accountId, paymentRef: String(o.id), metadata };
    case "charge.refunded": {
      if (typeof o.payment_intent !== "string") return { id: event.id, type: "ignored" };
      return {
        id: event.id,
        type: "payment_refunded",
        accountId,
        paymentRef: o.payment_intent,
        amountRefunded: Number(o.amount_refunded),
        amountPaid: Number(o.amount_captured ?? o.amount),
        currency: String(o.currency),
        metadata,
      };
    }
    default:
      return { id: event.id, type: "ignored" };
  }
}

export interface ConnectWebhookConfig {
  /** The Connect endpoint's signing secret (`whsec_…`), passed by the app. */
  secret: string;
  clock: Clock;
  /** Where applied ids are kept: a replay is a no-op. */
  store: EventStore;
  /** The only writers of paid / held / released / refunded and of the account's state. */
  handlers: ConnectHandlers;
  toleranceSeconds?: number;
}

export type ConnectOutcome = "applied" | "duplicate" | "ignored";

/**
 * Verifies the signature over the raw body, translates, and applies the event ONCE through the product's handler. When the handler
 * throws, the id is given back (`store.forget`) and the error propagates so the processor retries.
 * @throws PaymentsError `PAYMENTS_BAD_SIGNATURE` (400) on a bad or stale signature or a body that is not JSON
 */
export async function handleConnectWebhook(
  config: ConnectWebhookConfig,
  rawBody: string,
  signature: string | null,
): Promise<{ outcome: ConnectOutcome; event: ConnectEvent }> {
  const now = config.clock.now();
  verifySignature(
    rawBody,
    signature,
    config.secret,
    differenceInSeconds(now, new Date(0)),
    config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
  );
  let parsed: Parameters<typeof translateConnect>[0];
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new PaymentsError(400, "Body is not JSON", PAYMENTS_CODE.badSignature);
  }
  const event = translateConnect(parsed);
  if (event.type === "ignored") return { outcome: "ignored", event };
  const handler = config.handlers[event.type] as ((e: ConnectEvent) => Promise<void | "ignored">) | undefined;
  if (!handler) return { outcome: "ignored", event };
  if (!(await config.store.markSeen(event.id, event.type, now))) return { outcome: "duplicate", event };
  try {
    return { outcome: (await handler(event)) === "ignored" ? "ignored" : "applied", event };
  } catch (error) {
    await config.store.forget?.(event.id);
    throw error;
  }
}
