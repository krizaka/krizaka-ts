# @krizaka/payments

Payments for every Krizaka product, **the processor behind a port**. Moved here from krizaka-ui (same npm name, same version line: 0.2.2 became 0.3.0). The domain talks to `PaymentsPort` and to vendor-free `PaymentEvent`s; Stripe is one adapter (`processorAdapter`, over `fetch`, no SDK). Another processor is another adapter.

> **Money is integer minor units with a currency, never a float.** `money(1149, "CAD")` is `{ amountMinor: 1149, currency: "cad" }`. Prices are data (the `@krizaka/settings` price catalogue, ADR-009; the processor holds the price objects built from it). **Taxes (GST/QST) are the processor's** (Stripe Tax, `automatic_tax`, computed on the discounted amount) and never written here. No live key is read by this package: the keys are arguments, the setup command refuses live mode unless you say you are the owner, and every test uses fakes.

```ts
import { announcePayment, applyOnceInTransaction, dbDiscountStore, processorAdapter } from "@krizaka/payments";
import { transaction } from "@krizaka/db";

const payments = processorAdapter({
  secretKey, webhookSecret, // from the environment: PAYMENTS_STRIPE_SECRET_KEY, PAYMENTS_STRIPE_WEBHOOK_SECRET
  plans: { pro: { lookupKey: "yomizaka.pro", mode: "subscription" } },
  clock,                         // needed for expiresAt
  discounts: dbDiscountStore(query), // needed for a discount
  webhookToleranceSeconds,       // the admin's payments.webhookToleranceSeconds
});

// checkout, with a discount from the coupons module, a retry-safe key and a deadline
const { url, checkoutRef, expiresAt } = await payments.checkout({
  kind: "pro", customerId, accountId, successUrl, cancelUrl, locale: "fr",
  discount: terms,                 // DiscountTerms: one Stripe coupon per (couponId, termsVersion)
  idempotencyKey: redemptionId,    // a retry returns the same session
  metadata: { redemption_id: redemptionId },
  expiresAt,                       // 31 minutes to 24 hours from now, else PAYMENTS_BAD_EXPIRY
});

// the webhook route: verify, translate, then record the event and its effect in ONE transaction
const event = payments.parseWebhook(await req.text(), req.headers, Math.floor(clock.now().valueOf() / 1000)); // throws PaymentsError on a bad signature
await applyOnceInTransaction((work) => transaction(connect, work), event, {
  payment_paid: async (e, tx) => {
    await coupons.redeem(tx, { redemptionId: e.metadata.redemption_id, checkoutRef: e.checkoutRef, paymentRef: e.paymentRef, amountPaid: e.amountTotal, amountDiscount: e.amountDiscount, currency: e.currency });
    await announcePayment(tx, outbox, e); // evt.payment.paid.v1 on the « payments » topic, same transaction
  },
  checkout_expired: async (e, tx) => void (await coupons.release(tx, e.checkoutRef)),
  payment_refunded: async (e, tx) => void (await coupons.refund(tx, { paymentRef: e.paymentRef, amountRefunded: e.amountRefunded })),
}, { clock });
```

## What it gives

- **The port.** `createCustomer` (idempotent per account), `checkout`, `portal`, `price`, `parseWebhook`.
- **Discount terms.** `CheckoutRequest.discount` is `DiscountTerms` (`couponId`, `termsVersion`, `percentOffBp` basis points or `amountOffMinor` + `currency`, `duration` once / repeating / forever). The Stripe adapter makes **one Stripe coupon per `(couponId, termsVersion)`** (idempotency key `coupon-<id>-v<n>`), remembers it in `payments.discount`, and sends `discounts: [{ coupon }]` next to `automatic_tax`. It never makes a promotion code. A one-off payment accepts `once` only; bad terms are refused before any call (`PAYMENTS_BAD_DISCOUNT`).
- **Idempotency, metadata, deadline.** `idempotencyKey` is Stripe's header; `metadata` is echoed on the paid event (`account_id` and `kind` are the adapter's own); `expiresAt` becomes the session's `expires_at`, refused outside the processor's window (`PAYMENTS_BAD_EXPIRY`).
- **Events.** `payment_paid` and `subscription_started` carry `checkoutRef`, `paymentRef`, `invoiceRef`, `amountTotal`, `amountDiscount`, `currency`, `metadata`. `checkout_expired` (release a reservation) and `payment_refunded` (`amountRefunded` is **cumulative**; the payment is named by `paymentRef`, and by `invoiceRef` for a subscription) are translated too. A fully discounted checkout (`no_payment_required`) is a paid one without `paymentRef`.
- **Webhooks are verified and idempotent.** `Stripe-Signature` is checked in constant time over the raw body inside a replay window (the admin's setting). `applyOnceInTransaction` writes the event id and runs the handler in **one transaction**: a handler that throws leaves the event unrecorded and the retry applies it; many requests at once apply it exactly once (tested on PostgreSQL). `applyOnce` (id first, `forget` on failure) stays for handlers with no database effect.
- **Through the outbox.** `announcePayment(tx, outbox, event)` appends `evt.payment.<fact>.v1` to `@krizaka/outbox` in the handler's transaction, with an id derived from the processor's event id: announced once, delivered at least once.
- **Tables** (`paymentsSchema`, Postgres schema `payments`): `event` (the record of applied events) and `discount`. A product that has `public.payment_events` (Yomizaka migration 0009, Akinaza 0010) runs `adoptPaymentEventsSql()` once, which **moves the table with its rows** into `payments.event`, then emits version 1. Until then `pgEventStore(query)` reads `public.payment_events`.
- **Settings** (`@krizaka/payments/settings`): `payments.webhookToleranceSeconds` (300, 30–900).
- **Catalogue setup.** `krizaka-payments-setup --catalogue catalogue.json [--webhook-url …] [--secret-out file]` creates, idempotently, products, prices (tax exclusive), the customer portal and the webhook endpoint (now listening to `checkout.session.expired` and `charge.refunded` too; an older endpoint is updated). A changed amount is a new price that takes over the lookup key (`transfer_lookup_key`), so subscriptions already sold keep theirs. `plansFromPrices(entries, names)` builds the plans from the settings price catalogue: what is on sale, with a figure, in `month` / `year` / `once`.
- **Formatting.** `formatMoney` / `formatPrice`: « $39 » in English, « 39 $ » in French; decimals only when there are some; any currency's exponent.
- `eventStoreContract` and `discountStoreContract` (`@krizaka/payments/testkit`) are the contracts every store runs; `memoryEventStore()` and `memoryDiscountStore()` are for unit tests.

## Migrating from krizaka-ui's 0.1/0.2

`stripeAdapter` and `StripeAdapterConfig` are kept as aliases of `processorAdapter` and `ProcessorConfig`. `checkout` now answers `{ url, checkoutRef, expiresAt }`. `payment_paid` and `subscription_started` gained fields (never removed). `applyOnceInTransaction` writes to `payments.event` by default: pass `{ table: { schema: "public", table: "payment_events" } }` until `adoptPaymentEventsSql` has run. Environment: `PAYMENTS_PROVIDER`, `PAYMENTS_STRIPE_SECRET_KEY`, `PAYMENTS_STRIPE_WEBHOOK_SECRET`, as today (read by the product, never here).
