import crypto from "node:crypto";

import { type PaidFacts, type PaymentEvent, PAYMENTS_CODE, PaymentsError } from "./port";

/** The processor's documented replay tolerance for a webhook timestamp, in seconds; the admin's `payments.webhookToleranceSeconds` overrides it. */
// @fixed: the processor's documented default tolerance; the admin tunes it (payments.webhookToleranceSeconds)
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Checks `Stripe-Signature` (t=…,v1=…) over the raw body, constant-time, inside a replay window. */
export function verifySignature(rawBody: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS): void {
  const items = (header ?? "").split(",");
  const t = Number(items.find((kv) => kv.startsWith("t="))?.slice(2));
  const signatures = items.filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  if (!Number.isFinite(t) || signatures.length === 0) throw new PaymentsError(400, "Missing signature", PAYMENTS_CODE.badSignature);
  if (Math.abs(nowSeconds - t) > toleranceSeconds) throw new PaymentsError(400, "Timestamp outside the tolerance", PAYMENTS_CODE.badSignature);
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const ok = signatures.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!ok) throw new PaymentsError(400, "Bad signature", PAYMENTS_CODE.badSignature);
}

/** A signed header — for tests and a setup self-check. */
export const signPayload = (rawBody: string, secret: string, t: number) => `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;

const LIVE: ReadonlySet<string> = new Set(["active", "trialing"]);

type Obj = Record<string, unknown> & { metadata?: Record<string, string>; customer?: string; id?: string; total_details?: { amount_discount?: number } };

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** The references and amounts of a completed checkout session, in minor units. */
function paidFacts(o: Obj): PaidFacts {
  return {
    checkoutRef: text(o.id),
    paymentRef: text(o.payment_intent),
    invoiceRef: text(o.invoice),
    amountTotal: whole(o.amount_total),
    amountDiscount: whole(o.total_details?.amount_discount) ?? 0,
    currency: text(o.currency),
    metadata: { ...o.metadata },
  };
}

/** The processor's event, in the domain's words. Anything the domain does not need is `ignored`. */
export function translate(event: { id: string; type: string; data: { object: Record<string, unknown> } }): PaymentEvent {
  const o = event.data.object as Obj;
  const customerId = text(o.customer);
  switch (event.type) {
    case "checkout.session.completed": {
      const accountId = o.metadata?.account_id ?? text(o.client_reference_id);
      if (!accountId) return { id: event.id, type: "ignored" };
      if (o.mode === "payment" && (o.payment_status === "paid" || o.payment_status === "no_payment_required") && o.metadata?.kind) return { id: event.id, type: "payment_paid", kind: o.metadata.kind, accountId, customerId, ...paidFacts(o) };
      if (o.mode === "subscription") return { id: event.id, type: "subscription_started", accountId, customerId, subscriptionId: text(o.subscription), ...paidFacts(o) };
      return { id: event.id, type: "ignored" };
    }
    case "checkout.session.expired": {
      const checkoutRef = text(o.id);
      if (!checkoutRef) return { id: event.id, type: "ignored" };
      return { id: event.id, type: "checkout_expired", checkoutRef, accountId: o.metadata?.account_id ?? text(o.client_reference_id), metadata: { ...o.metadata } };
    }
    case "charge.refunded": {
      const chargeRef = text(o.id);
      const amountRefunded = whole(o.amount_refunded);
      const currency = text(o.currency);
      if (!chargeRef || amountRefunded === null || !currency) return { id: event.id, type: "ignored" };
      return { id: event.id, type: "payment_refunded", paymentRef: text(o.payment_intent), invoiceRef: text(o.invoice), chargeRef, amountRefunded, amountCharged: whole(o.amount) ?? 0, currency, metadata: { ...o.metadata } };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const status = event.type === "customer.subscription.deleted" ? "canceled" : String(o.status ?? "");
      const item = ((o.items as { data?: { current_period_end?: number }[] } | undefined)?.data ?? [])[0];
      return {
        id: event.id,
        type: "subscription_changed",
        accountId: o.metadata?.account_id ?? null,
        customerId,
        subscriptionId: String(o.id ?? ""),
        status,
        active: LIVE.has(status),
        periodEnd: item?.current_period_end ?? (typeof o.current_period_end === "number" ? o.current_period_end : null),
      };
    }
    default:
      return { id: event.id, type: "ignored" };
  }
}
