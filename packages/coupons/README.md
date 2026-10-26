# @krizaka/coupons

**Discount and credit coupons the admin manages**, for every Krizaka product (decision: [ADR-002](../../docs/adr/ADR-002-coupons.md), design: [coupons.md](../../docs/design/coupons.md)). The product's database is the source of truth; the payment provider applies a discount from immutable terms this module hands it; a credit coupon grants capped credits in `@krizaka/credits`. It evolves what exists: it does not start a second billing system.

> **A free offer is always a capped credit coupon, never a 100 % discount.** A discount stops at 99.99 % and at the admin's `coupons.maxPercentOff`; a fixed amount never runs forever and never exceeds that share of the price; a credit coupon always carries credits, an expiry and what happens when they run out.

Two kinds, one code (letters and digits, read without case, spaces or hyphens: « summer-2026 » is `SUMMER2026`):

- **Discount**: a percentage (basis points) or a fixed amount with its currency, a duration (`once`, `repeating` N months, `forever`), a plan scope and a minimum. Applied at checkout.
- **Credit**: `credits` granted, optional `capPerDay` / `capPerMonth`, `creditsValidDays`, `onExhausted` (`stop` or `fallback_paid`). Redeemed where the product redeems credits.

Both: `startsAt` / `endsAt`, `maxRedemptions` overall and `maxPerAccount`, `newCustomersOnly`, a purpose (`partner`, `promo`, `demo`, `support`) and, for a partner, the partner who sells with it.

```ts
import { createCoupons } from "@krizaka/coupons";
import { readCouponSettings } from "@krizaka/coupons/settings";

const coupons = createCoupons({ clock, settings: () => readCouponSettings((key) => settings.get(key)), audit, rateLimit: limiter, credits, outbox });

// 1. the person types the code in « Code promo » (read-only; counts one attempt on the limiter, before any lookup)
const v = await coupons.validate(query, typed, { mode: "checkout", accountId, plan: "pro", amountMinor: 3900, currency: "cad", hasPaidBefore });
//    v = { ok: true, effect: { discountMinor, payableMinor, … } }  or  { ok: false, code: "COUPON_EXPIRED" }

// 2. « Pay »: three steps, NO network call inside a transaction or under the coupon's row lock
const applied = await transaction(connect, (tx) => coupons.apply(tx, { code: typed, accountId, plan: "pro", amountMinor: 3900, currency: "cad", idempotencyKey: attemptId })); // reserves a use
const session = await payments.checkout({ …, discount: applied.discount, idempotencyKey: applied.redemptionId, metadata: { redemption_id: applied.redemptionId }, expiresAt }); // @krizaka/payments
await transaction(connect, (tx) => coupons.attachCheckout(tx, applied.redemptionId, session.checkoutRef, session.expiresAt));
//    if the session fails: coupons.release(tx, { redemptionId })

// 3. the payment webhook, in the event's transaction (applyOnceInTransaction of @krizaka/payments)
payment_paid:     (e, tx) => coupons.redeem(tx, { redemptionId: e.metadata.redemption_id, checkoutRef: e.checkoutRef, paymentRef: e.paymentRef ?? e.invoiceRef, amountPaidMinor: e.amountTotal, amountDiscountMinor: e.amountDiscount, currency: e.currency })
checkout_expired: (e, tx) => coupons.release(tx, { checkoutRef: e.checkoutRef })
payment_refunded: (e, tx) => coupons.refund(tx, { paymentRef: e.paymentRef, invoiceRef: e.invoiceRef, amountRefunded: e.amountRefunded })

// a credit code: the same rules, then a capped grant in the same transaction
await transaction(connect, (tx) => coupons.redeemCredit(tx, { code: typed, accountId, idempotencyKey: attemptId }));
```

## The rules

- **A use is counted by one rule**: a redemption is a use when it is `confirmed` or `revoked` and not `use_restored`, or `reserved` and not past its deadline. A `released` one never counts. The overall and the per-account limits both apply it. « Expired », « exhausted » and « not started » are computed, so no cron is needed.
- **Reserve, confirm, release.** `apply` locks the coupon row (`SELECT … FOR UPDATE`), re-checks everything, inserts a `reserved` redemption with a deadline (`coupons.reservationMinutes`) and commits: two requests for the last use give it to one (tested on PostgreSQL, 50 rounds). `redeem` runs in the payment event's transaction; its guarded transition (`UPDATE … WHERE status IN ('reserved', 'released')`) and the unique `payment_ref` mean a use is confirmed once whatever the number of deliveries. The webhook finds the reservation by `metadata.redemption_id` even if `attachCheckout` never ran.
- **A late payment is honoured.** A payment for a released or lapsed reservation is confirmed anyway and flagged `over_limit`: the customer paid the discounted price in good faith. It is audited and shown in the admin.
- **Refunds** add up (the amount is cumulative) and never change the status. A partial refund keeps the use; a full one gives it back only when `coupons.refundRestoresUse` is on (default off), so a refund cannot reset a single-use code.
- **Terms are immutable once anyone has used the coupon** (`COUPON_TERMS_LOCKED`): the provider's object is made from them, per `termsVersion`. Dates, limits, plans, status and partner stay editable. When a plan's price changes, `admin.checkPrices(prices)` pauses the fixed-amount coupons that would now exceed the bound.
- **Taxes are the provider's.** The terms go to `@krizaka/payments`, whose adapter sends the discount together with `automatic_tax`: Stripe Tax computes GST and QST on the discounted amount. The numbers in `effect` are informational. No tax is written here.
- **Abuse.** `validate`, `apply` and `redeemCredit` each count one attempt on the limiter (`COUPON_ATTEMPT_ACTION`, limits `coupons.attemptsPerAccountPerHour` / `attemptsPerIpPerHour`) before any lookup; past the limit they answer `COUPON_RATE_LIMITED` with `retryAfterSeconds`.
- **Refusals** are typed (`COUPON_CODE`): `UNKNOWN`, `NOT_STARTED`, `EXPIRED`, `PAUSED`, `EXHAUSTED`, `ACCOUNT_LIMIT`, `NEW_CUSTOMERS_ONLY`, `NOT_FOR_PLAN`, `MINIMUM`, `CURRENCY`, `TOO_LARGE`, `KIND`, `PROVIDER`, `RATE_LIMITED`, `DISABLED`. `CouponError` carries the code and the HTTP `status` (404, 422, 429…).

## Partners (Loi 25)

A partner is a person who sells for us: a display name and an optional e-mail, for one purpose (attributing sales), visible to the admin only. `admin.partners.report` gives, per coupon and currency, the redemptions, the discount given, the revenue (paid minus refunded) and the credits granted, never a customer's identity; every read is audited. `export` returns the record and its aggregates; `erase` blanks the name and the e-mail and keeps the aggregates (the redemptions are accounting records). **Commission is out of scope**: the hook is `evt.coupon.redeemed.v1`, which carries `partnerId`, the amounts and the credits, for a later module to consume from the outbox.

## What you provide, what it gives

- **Dependencies** are structural ports, so this package imports none of them: `audit` (`createAudit` of `@krizaka/audit`), `rateLimit` (`createLimiter` of `@krizaka/rate-limit`), `credits` (`createCredits` of `@krizaka/credits`), `outbox` (`createOutbox` of `@krizaka/outbox`).
- **Events** through the outbox, in the caller's transaction, ids derived from the fact: `evt.coupon.redeemed.v1`, `evt.coupon.released.v1`, `evt.coupon.refunded.v1`, `evt.coupon.exhausted.v1`, with a JSON Schema each (`COUPON_EVENT_SCHEMAS`).
- **Settings** (`@krizaka/coupons/settings`, every change audited by the settings service): `coupons.enabled` (off), `reservationMinutes` (60, 40–1440: the provider's session window), `attemptsPerAccountPerHour` (10), `attemptsPerIpPerHour` (30), `minCodeLength` (8), `generatedCodeLength` (10), `maxPercentOff` (50, 1–99: **the default is Oussama's call**, krizaka-ts#61), `refundRestoresUse` (off). `credits.timeZone` is `@krizaka/credits`'. Nothing new in the environment: the provider keys stay `PAYMENTS_*`.
- **Tables** (`couponsSchema`, Postgres schema `coupons`): `partner`, `coupon`, `redemption`, with CHECKs that repeat the rules (a free discount cannot be stored). A deleted account leaves its redemptions (`ON DELETE SET NULL`).
- `couponsContract` (`@krizaka/coupons/testkit`) is the contract every store runs; `memoryCouponStore()` is for unit tests (it locks nothing: concurrency is proved on PostgreSQL).

## Going live

The code runs against the provider's test mode only. Turning coupons on in live mode, product by product, is the owner's call (krizaka-ts#61), and so are the retention of the redemption records and the tax status of free credits (krizaka-ts#62, for the accountant): nothing here assumes either.
