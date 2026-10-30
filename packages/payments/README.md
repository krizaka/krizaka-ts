# @krizaka/payments

Payments for every Krizaka product, **the processor behind a port**. Moved here from krizaka-ui (same npm name, same version line: 0.2.2 became 0.3.0). The domain talks to `PaymentsPort` and to vendor-free `PaymentEvent`s; Stripe is one adapter (`processorAdapter`, over `fetch`, no SDK). Another processor is another adapter.

> **Money is integer minor units with a currency, never a float.** `money(1149, "CAD")` is `{ amountMinor: 1149, currency: "cad" }`. Prices are data (the `@krizaka/settings` price catalogue, ADR-009; the processor holds the price objects built from it). **Taxes (GST/QST) are the processor's** (Stripe Tax, `automatic_tax`, computed on the discounted amount) and never written here. No live key is read by this package: the keys are arguments, the setup command refuses live mode unless you say you are the owner, and every test uses fakes.

```ts
import { announcePayment, applyOnceInTransaction, dbDiscountStore, processorAdapter } from "@krizaka/payments";
import { transaction } from "@krizaka/db";

const payments = processorAdapter({
  secretKey,
  webhookSecret, // from the environment: PAYMENTS_STRIPE_SECRET_KEY, PAYMENTS_STRIPE_WEBHOOK_SECRET
  plans: { pro: { lookupKey: "yomizaka.pro", mode: "subscription" } },
  clock, // needed for expiresAt
  discounts: dbDiscountStore(query), // needed for a discount
  webhookToleranceSeconds, // the admin's payments.webhookToleranceSeconds
});

// checkout, with a discount from the coupons module, a retry-safe key and a deadline
const { url, checkoutRef, expiresAt } = await payments.checkout({
  kind: "pro",
  customerId,
  accountId,
  successUrl,
  cancelUrl,
  locale: "fr",
  discount: terms, // DiscountTerms: one Stripe coupon per (couponId, termsVersion)
  idempotencyKey: redemptionId, // a retry returns the same session
  metadata: { redemption_id: redemptionId },
  expiresAt, // 31 minutes to 24 hours from now, else PAYMENTS_BAD_EXPIRY
});

// the webhook route: verify, translate, then record the event and its effect in ONE transaction
const event = payments.parseWebhook(await req.text(), req.headers, Math.floor(clock.now().valueOf() / 1000)); // throws PaymentsError on a bad signature
await applyOnceInTransaction(
  (work) => transaction(connect, work),
  event,
  {
    payment_paid: async (e, tx) => {
      await coupons.redeem(tx, {
        redemptionId: e.metadata.redemption_id,
        checkoutRef: e.checkoutRef,
        paymentRef: e.paymentRef,
        amountPaid: e.amountTotal,
        amountDiscount: e.amountDiscount,
        currency: e.currency,
      });
      await announcePayment(tx, outbox, e); // evt.payment.paid.v1 on the « payments » topic, same transaction
    },
    checkout_expired: async (e, tx) => void (await coupons.release(tx, e.checkoutRef)),
    payment_refunded: async (e, tx) =>
      void (await coupons.refund(tx, { paymentRef: e.paymentRef, amountRefunded: e.amountRefunded })),
  },
  { clock },
);
```

## What it gives

- **The port.** `createCustomer` (idempotent per account), `checkout`, `portal`, `price`, `charge`, `refund`, `parseWebhook`.
- **A one-off charge per item.** `charge({ key, customerId, amountMinor, currency, description, taxCode })` makes one invoice with one line taxed by Stripe Tax (amount before tax), finalises and pays it with the saved payment method; every call is keyed by `key`. A declined payment voids the invoice and throws `PAYMENTS_DECLINED`; `refund(ref, { key, amountMinor })` takes the invoice or payment reference.
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

## Connect: the merchant's own processor (Stripe Connect Standard)

For a product whose customers are merchants (a shop taking its own clients' payments). Each shop connects **its own** Stripe account through Stripe-hosted onboarding; every charge is a **direct charge on that account** (`Stripe-Account`): the shop stays the merchant of record and Krizaka never holds the money. The library never reads env: the app passes the platform key, the webhook secret, the clock and the stores.

```ts
const connect = connectAdapter({ secretKey, fetch }); // ConnectPort
const { accountId } = await connect.createAccount({ key: shopId, email, country: "ca" });
const { url } = await connect.onboardingLink({ accountId, returnUrl, refreshUrl }); // redirect the owner
const status = await connect.accountStatus(accountId); // chargesEnabled, detailsSubmitted, state: pending | restricted | active
const { customerId } = await connect.createCustomer(accountId, { key, email });
const { clientSecret } = await connect.saveCard(accountId, { key, customerId }); // the browser confirms it with the processor's form
const deposit = await connect.pay(accountId, {
  key: bookingId,
  customerId,
  paymentMethodRef,
  amountMinor: 2000,
  currency: "cad",
  mode: "hold",
});
await connect.capture(accountId, deposit.paymentRef, { key: `${bookingId}:cap`, amountMinor: 1500 }); // or connect.release(...)
await connect.refund(accountId, deposit.paymentRef, { key: `${bookingId}:ref`, amountMinor: 500 });
```

- **No card data.** There is no card number, CVC or expiry field anywhere in the port: a card is saved by the processor's own form (`saveCard` returns the `clientSecret` only) and used by reference.
- **Money** is integer minor units; `mode: "capture"` takes the payment, `"hold"` authorises it (a deposit kept as a guarantee) until `capture` (all or part) or `release`. `applicationFeeMinor` is the platform's optional fee (0 by default, below the amount, else `PAYMENTS_BAD_FEE`).
- **A refund never exceeds what was paid:** the adapter reads the payment and refuses above paid minus already refunded (`PAYMENTS_REFUND_EXCEEDS_PAID`), or a payment never captured (`PAYMENTS_NO_PAYMENT`). Every call takes an idempotency `key`.
- **ONE Connect webhook** on the platform account (created once in config, its secret in the env; shops declare nothing): `handleConnectWebhook({ secret, clock, store, handlers }, rawBody, signatureHeader)` verifies the signature, routes by the event's `account`, applies each event once (`store.markSeen`, a replay is `duplicate`, a failing handler gives the id back). `handlers` (`account_updated`, `payment_paid`, `payment_held`, `payment_released`, `payment_refunded`, the refund total being cumulative) are **the only writers** of paid / refunded: a route never marks a booking paid itself. A notification without an `account` is the platform's own and is ignored.
- **What a product must show the client before confirming** a deposit or a card on file: the amount, the cancellation and no-show policy, and the refund rules (Québec Consumer Protection Act; reviewed in the single lawyer review, krizaka/.github#250). The no-show fee is the product's decision (policy id and reason in its own audit); the library only moves the money.
- Pre-authorised debit (PAD, Canada) is a later adapter step behind the same port.

## Migrating from krizaka-ui's 0.1/0.2

`stripeAdapter` and `StripeAdapterConfig` are kept as aliases of `processorAdapter` and `ProcessorConfig`. `checkout` now answers `{ url, checkoutRef, expiresAt }`. `payment_paid` and `subscription_started` gained fields (never removed). `applyOnceInTransaction` writes to `payments.event` by default: pass `{ table: { schema: "public", table: "payment_events" } }` until `adoptPaymentEventsSql` has run. Environment: `PAYMENTS_PROVIDER`, `PAYMENTS_STRIPE_SECRET_KEY`, `PAYMENTS_STRIPE_WEBHOOK_SECRET`, as today (read by the product, never here).

### Testing a Connect app

`memoryConnect()` is the in-memory `ConnectPort` for your tests: same refusals as `connectAdapter` (typed `PaymentsError`), idempotent per key, and a deposit capture racing a release is serialised so exactly one wins and the other is refused with `PAYMENTS_NOT_HELD`. `activate(accountId)` plays the end of onboarding.

An opt-in contract test runs the real adapter against the processor's test mode: set `PAYMENTS_CONTRACT_KEY` to a test-mode key (`sk_test_…` only; any other value is ignored) and run `pnpm --filter @krizaka/payments test`. Default CI never sets it.
