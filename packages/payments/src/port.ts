/**
 * The payments PORT. A product's domain knows its plans (named by the product), customers and these events — never a vendor.
 * The adapter is chosen by the product's configuration; another processor is another adapter. Prices are data (the settings'
 * catalogue, the processor's price objects): no amount appears in code. Amounts are integer minor units with a currency, never floats.
 */
export type { Clock } from "@krizaka/db";

export type PlanKind = string;

/** An amount: integer minor units (cents) and a lowercase ISO 4217 currency. */
export interface Money {
  amountMinor: number;
  currency: string;
}

/**
 * The terms of a discount, vendor-free and IMMUTABLE for a `(couponId, termsVersion)`: a change of terms is a new version, so the
 * processor's object made for a version is never edited. Exactly one of `percentOffBp` (basis points: 2000 = 20 %) and
 * `amountOffMinor` (with its `currency`) is set.
 */
export interface DiscountTerms {
  couponId: string;
  termsVersion: number;
  percentOffBp?: number;
  amountOffMinor?: number;
  currency?: string;
  /** `once`: the first invoice or payment; `repeating`: `durationMonths` months; `forever`. A one-off payment accepts `once` only. */
  duration: "once" | "repeating" | "forever";
  durationMonths?: number;
}

/** The facts every paid event carries: what was charged, what the discount took off, and the references to find the checkout again. */
export interface PaidFacts {
  /** The checkout session's id: how a reservation is found again. */
  checkoutRef: string | null;
  /** The processor's payment reference (a payment intent), or null for a free checkout. */
  paymentRef: string | null;
  /** The invoice of a subscription's first charge. A refund names the payment; both let a consumer match. */
  invoiceRef: string | null;
  /** Tax included, after the discount, in minor units. */
  amountTotal: number | null;
  /** What the discount took off, in minor units (0 when none). */
  amountDiscount: number;
  currency: string | null;
  /** The metadata the checkout was created with (`redemption_id`…). */
  metadata: Record<string, string>;
}

/** What the domain learns from a processor, vendor-free. `id` is unique per event: the domain applies each once. */
export type PaymentEvent =
  | ({ id: string; type: "payment_paid"; kind: PlanKind; accountId: string; customerId: string | null } & PaidFacts)
  | ({
      id: string;
      type: "subscription_started";
      accountId: string;
      customerId: string | null;
      subscriptionId: string | null;
    } & PaidFacts)
  | {
      id: string;
      type: "subscription_changed";
      accountId: string | null;
      customerId: string | null;
      subscriptionId: string;
      status: string;
      active: boolean;
      periodEnd: number | null;
      /** The subscription stays active until `periodEnd`, then ends: the customer cancelled and nothing renews. False once it has ended. */
      cancelAtPeriodEnd: boolean;
    }
  | {
      id: string;
      type: "checkout_expired";
      checkoutRef: string;
      accountId: string | null;
      metadata: Record<string, string>;
    }
  | {
      id: string;
      type: "payment_refunded";
      paymentRef: string | null;
      invoiceRef: string | null;
      chargeRef: string;
      /** CUMULATIVE: all refunds of the payment so far. */ amountRefunded: number;
      amountCharged: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | { id: string; type: "ignored" };

export interface CheckoutRequest {
  kind: PlanKind;
  customerId: string;
  accountId: string;
  successUrl: string;
  cancelUrl: string;
  locale: "en" | "fr";
  /** A discount, applied by the processor to the session. The processor takes one per session; tax is computed on the discounted amount. */
  discount?: DiscountTerms;
  /** A retry with the same key returns the same session (the coupons' redemption id). */
  idempotencyKey?: string;
  /** Echoed on the paid event. Keys and values are strings. `account_id` and `kind` are the adapter's own. */
  metadata?: Record<string, string>;
  /** When the unpaid session expires: 30 minutes to 24 hours after the call (the processor's window), else the adapter refuses. */
  expiresAt?: Date;
}

/** The processor's price of a plan: integer minor units (cents), a lowercase ISO currency, the billing interval (null = one-off). */
export interface Price {
  amount: number;
  currency: string;
  interval: "day" | "week" | "month" | "year" | null;
}

/** A one-off charge of an amount the product computed (a provider's cost plus a margin, say), on a customer who already holds a payment method. */
export interface ChargeRequest {
  /** Makes the charge idempotent: a retry with the same key never charges twice, and returns the same result. Stable per thing sold (a check id). */
  key: string;
  customerId: string;
  /** Before tax, integer minor units, positive. */
  amountMinor: number;
  currency: string;
  /** The invoice line the customer reads. */
  description: string;
  /** The processor's tax code of the service (Stripe Tax); without it the account's default applies. */
  taxCode?: string;
  /** Echoed on the invoice. */
  metadata?: Record<string, string>;
}

/** A charge that went through: the invoice reference to refund by, the payment reference when the processor gave one, and what was taken. */
export interface ChargeResult {
  /** The invoice's reference: pass it to `refund`. */
  ref: string;
  paymentRef: string | null;
  /** Tax included, in minor units. */
  amountTotal: number;
  /** The tax in it, in minor units (0 when none applies). */
  amountTax: number;
  currency: string;
}

export interface RefundOptions {
  /** Makes the refund idempotent. */
  key?: string;
  /** Part of the payment, in minor units; the whole payment when omitted. */
  amountMinor?: number;
}

export interface PaymentsPort {
  /** Creates the processor's customer for an account (idempotent per account). */
  createCustomer(email: string, accountId: string): Promise<{ id: string }>;
  /** A hosted payment page for a plan; the amount, the taxes and the invoice are the processor's. */
  checkout(request: CheckoutRequest): Promise<{ url: string; checkoutRef: string; expiresAt: Date | null }>;
  /** The hosted page where the customer manages the subscription and the invoices, and cancels. */
  portal(customerId: string, returnUrl: string, locale: "en" | "fr"): Promise<{ url: string }>;
  /** The processor's current price of a plan (read by lookup key). */
  price(kind: PlanKind): Promise<Price>;
  /**
   * A one-off charge with tax: an invoice with one line, taxed by the processor (Stripe Tax, from the customer's address), finalised and
   * paid with the customer's saved payment method. A declined payment or an address the tax cannot be computed for leaves nothing
   * billed (the invoice is voided) and throws `PAYMENTS_DECLINED` or `PAYMENTS_PROCESSOR`.
   */
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Gives a charge back, in whole or in part. `ref` is `ChargeResult.ref` (an invoice) or a payment reference. */
  refund(
    ref: string,
    options?: RefundOptions,
  ): Promise<{ refundRef: string; amountRefunded: number; currency: string }>;
  /** Verifies the notification's proof of origin (read from its headers) over the raw body and translates it; throws `PaymentsError` on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers, nowSeconds: number): PaymentEvent;
}

/** Where the ids of the notifications already applied are kept (one line per notification). */
export interface EventStore {
  /** Records the id; true when it is new, false when it was already there. Must be atomic (a unique key). `at` is the receipt time, from the injected clock. */
  markSeen(id: string, type: string, at?: Date): Promise<boolean>;
  /** Gives the id back after its handler failed, so the processor's retry runs it. A store without it keeps the id. */
  forget?(id: string): Promise<void>;
}

/** Where the processor's object made for a discount's terms is remembered, so one `(couponId, termsVersion)` makes one object. */
export interface DiscountStore {
  find(couponId: string, termsVersion: number, provider: string): Promise<string | null>;
  /** Remembers it; a second remember of the same terms keeps the first and answers it. */
  remember(couponId: string, termsVersion: number, provider: string, providerRef: string): Promise<string>;
}

export const PAYMENTS_CODE = {
  badSignature: "PAYMENTS_BAD_SIGNATURE",
  unknownPlan: "PAYMENTS_UNKNOWN_PLAN",
  noPrice: "PAYMENTS_NO_PRICE",
  badDiscount: "PAYMENTS_BAD_DISCOUNT",
  badExpiry: "PAYMENTS_BAD_EXPIRY",
  needsClock: "PAYMENTS_NEEDS_CLOCK",
  processor: "PAYMENTS_PROCESSOR",
  badMoney: "PAYMENTS_BAD_MONEY",
  declined: "PAYMENTS_DECLINED",
  noPayment: "PAYMENTS_NO_PAYMENT",
} as const;
export type PaymentsCode = (typeof PAYMENTS_CODE)[keyof typeof PAYMENTS_CODE];

/** A refusal of this package: the HTTP `status` a route may answer, a stable `code`, a message. */
export class PaymentsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: PaymentsCode = PAYMENTS_CODE.processor,
  ) {
    super(message);
    this.name = "PaymentsError";
  }
}
