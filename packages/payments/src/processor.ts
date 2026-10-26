import { differenceInSeconds } from "@krizaka/time";

import { rawCall } from "./http";
import { type CheckoutRequest, type Clock, type DiscountStore, type DiscountTerms, PAYMENTS_CODE, PaymentsError, type PaymentsPort, type PlanKind, type Price } from "./port";
import { DEFAULT_TOLERANCE_SECONDS, translate, verifySignature } from "./webhook";

/** How a plan is bought: a one-off payment or a subscription, and where its price is found. */
export interface PlanConfig {
  /** The price's lookup key at the processor (prices are its data). */
  lookupKey: string;
  mode: "payment" | "subscription";
}

export interface ProcessorConfig {
  secretKey: string;
  webhookSecret: string;
  plans: Record<PlanKind, PlanConfig>;
  fetch?: typeof fetch;
  apiBase?: string;
  /** Needed by `checkout` when the request has `expiresAt` (the adapter checks the processor's window against now). */
  clock?: Clock;
  /** Needed by `checkout` when the request has a `discount`: where the object made for each terms version is remembered. */
  discounts?: DiscountStore;
  /** The webhook timestamp tolerance in seconds: the admin's `payments.webhookToleranceSeconds`. Default 300. */
  webhookToleranceSeconds?: number;
}

/** @deprecated the name before the cut to krizaka-ts, kept so a product's import keeps compiling. */
export type StripeAdapterConfig = ProcessorConfig;

const PROVIDER = "stripe";
// @fixed: the processor's documented window for a Checkout Session's `expires_at`: from 30 minutes (we ask for 31) to 24 hours after creation
const MIN_EXPIRY_SECONDS = 31 * 60;
// @fixed: the processor's documented ceiling for a Checkout Session's `expires_at`
const MAX_EXPIRY_SECONDS = 24 * 3600;

const refuse = (message: string, code: (typeof PAYMENTS_CODE)[keyof typeof PAYMENTS_CODE], status = 422) => new PaymentsError(status, message, code);

/** Checks the terms a discount is made of, before any call. @throws PaymentsError `PAYMENTS_BAD_DISCOUNT` */
export function assertTerms(terms: DiscountTerms, mode: PlanConfig["mode"]): void {
  const percent = terms.percentOffBp !== undefined;
  const amount = terms.amountOffMinor !== undefined;
  if (percent === amount) throw refuse("A discount is a percentage or an amount, never both and never neither", PAYMENTS_CODE.badDiscount);
  if (percent && !(Number.isSafeInteger(terms.percentOffBp) && terms.percentOffBp! >= 1 && terms.percentOffBp! <= 10_000)) throw refuse("A percentage is 1 to 10000 basis points", PAYMENTS_CODE.badDiscount);
  if (amount && !(Number.isSafeInteger(terms.amountOffMinor) && terms.amountOffMinor! > 0 && /^[a-z]{3}$/.test(terms.currency ?? ""))) throw refuse("An amount off is a positive integer of minor units with a lowercase currency", PAYMENTS_CODE.badDiscount);
  if (!Number.isSafeInteger(terms.termsVersion) || terms.termsVersion < 1) throw refuse("The terms version starts at 1", PAYMENTS_CODE.badDiscount);
  if (terms.duration === "repeating" && !(Number.isSafeInteger(terms.durationMonths) && terms.durationMonths! >= 1)) throw refuse("A repeating discount names its months", PAYMENTS_CODE.badDiscount);
  if (mode === "payment" && terms.duration !== "once") throw refuse("A one-off payment takes a discount of duration « once » only", PAYMENTS_CODE.badDiscount);
}

/** The Stripe adapter of the payments port. Stripe Tax computes the taxes (on the discounted amount) from the buyer's address; prices are found by lookup key. */
export function processorAdapter(config: ProcessorConfig): PaymentsPort {
  async function call<T>(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
    const { ok, status, json } = await rawCall(config, method, path, params, idempotencyKey);
    if (!ok) throw new PaymentsError(status, json.error?.message ?? `Stripe answered ${status}`);
    return json as T;
  }
  const plan = (kind: PlanKind): PlanConfig => {
    const found = config.plans[kind];
    if (!found) throw new PaymentsError(404, `Unknown plan ${kind}`, PAYMENTS_CODE.unknownPlan);
    return found;
  };
  const priceRow = async (kind: PlanKind) => {
    const { lookupKey } = plan(kind);
    const list = await call<{ data: { id: string; unit_amount?: number; currency?: string; recurring?: { interval: Price["interval"] } | null }[] }>("GET", "/v1/prices", { lookup_keys: [lookupKey], active: true, limit: 1 });
    const row = list.data[0];
    if (!row) throw new PaymentsError(404, `No active price with the lookup key ${lookupKey}`, PAYMENTS_CODE.noPrice);
    return row;
  };
  /** One processor coupon per `(couponId, termsVersion)`: found in the store, else made once (the key makes a race one object). */
  async function couponFor(terms: DiscountTerms): Promise<string> {
    if (!config.discounts) throw refuse("A discount needs the adapter's `discounts` store", PAYMENTS_CODE.badDiscount, 500);
    const known = await config.discounts.find(terms.couponId, terms.termsVersion, PROVIDER);
    if (known) return known;
    const made = await call<{ id: string }>(
      "POST",
      "/v1/coupons",
      {
        ...(terms.percentOffBp === undefined ? { amount_off: terms.amountOffMinor, currency: terms.currency } : { percent_off: terms.percentOffBp / 100 }),
        duration: terms.duration,
        ...(terms.duration === "repeating" ? { duration_in_months: terms.durationMonths } : {}),
        metadata: { coupon_id: terms.couponId, terms_version: String(terms.termsVersion) },
      },
      `coupon-${terms.couponId}-v${terms.termsVersion}`,
    );
    return config.discounts.remember(terms.couponId, terms.termsVersion, PROVIDER, made.id);
  }
  /** The session's `expires_at` in epoch seconds, refused outside the processor's 30 minutes to 24 hours window. */
  function expirySeconds(expiresAt: Date): number {
    if (!config.clock) throw refuse("`expiresAt` needs the adapter's clock", PAYMENTS_CODE.needsClock, 500);
    const now = config.clock.now();
    const ahead = differenceInSeconds(expiresAt, now);
    if (ahead < MIN_EXPIRY_SECONDS) throw refuse(`The session must expire at least ${MIN_EXPIRY_SECONDS / 60} minutes from now`, PAYMENTS_CODE.badExpiry);
    if (ahead > MAX_EXPIRY_SECONDS) throw refuse("The session must expire within 24 hours", PAYMENTS_CODE.badExpiry);
    return Math.floor(expiresAt.valueOf() / 1000);
  }
  return {
    async price(kind) {
      const row = await priceRow(kind);
      return { amount: row.unit_amount ?? 0, currency: row.currency ?? "usd", interval: row.recurring?.interval ?? null };
    },
    createCustomer: (email, accountId) => call<{ id: string }>("POST", "/v1/customers", { email, metadata: { account_id: accountId } }, `customer-${accountId}`),
    async checkout(p: CheckoutRequest) {
      const { mode } = plan(p.kind);
      if (p.discount) assertTerms(p.discount, mode);
      const expiresAt = p.expiresAt ? expirySeconds(p.expiresAt) : undefined;
      const coupon = p.discount ? await couponFor(p.discount) : undefined;
      const session = await call<{ id: string; url: string; expires_at?: number }>(
        "POST",
        "/v1/checkout/sessions",
        {
          mode,
          customer: p.customerId,
          client_reference_id: p.accountId,
          line_items: [{ price: (await priceRow(p.kind)).id, quantity: 1 }],
          ...(coupon ? { discounts: [{ coupon }] } : {}),
          automatic_tax: { enabled: true },
          customer_update: { address: "auto", name: "auto" },
          billing_address_collection: "required",
          tax_id_collection: { enabled: true },
          ...(mode === "payment" ? { invoice_creation: { enabled: true } } : { subscription_data: { metadata: { account_id: p.accountId } } }),
          metadata: { ...p.metadata, account_id: p.accountId, kind: p.kind },
          ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          locale: p.locale,
        },
        p.idempotencyKey,
      );
      return { url: session.url, checkoutRef: session.id, expiresAt: typeof session.expires_at === "number" ? new Date(session.expires_at * 1000) : null };
    },
    portal: (customerId, returnUrl, locale) => call<{ url: string }>("POST", "/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl, locale }),
    parseWebhook(rawBody, headers, nowSeconds) {
      verifySignature(rawBody, headers.get("stripe-signature"), config.webhookSecret, nowSeconds, config.webhookToleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS);
      return translate(JSON.parse(rawBody));
    },
  };
}

/** @deprecated the name before the cut to krizaka-ts. */
export const stripeAdapter = processorAdapter;
