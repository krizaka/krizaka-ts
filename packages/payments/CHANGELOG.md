# @krizaka/payments

## 0.5.0

### Minor Changes

- 70687cc: `subscription_changed` carries `cancelAtPeriodEnd`: true while the subscription is active but will not renew (the customer cancelled; the processor's `cancel_at_period_end`), false once it has ended. A product shows « Ends on <periodEnd> » instead of « Renews on ».

## 0.4.2

### Patch Changes

- Updated dependencies [2a7898c]
- Updated dependencies [2272b57]
  - @krizaka/time@0.2.0
  - @krizaka/settings@0.5.2

## 0.4.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.4.0

### Minor Changes

- 73fd3a3: One-off per-item charge (#132): `PaymentsPort.charge({ key, customerId, amountMinor, currency, description, taxCode })` makes one invoice with one taxed line (Stripe Tax, tax behaviour exclusive), finalises and pays it with the saved payment method, every call keyed by `key`; a declined payment voids the invoice and throws `PAYMENTS_DECLINED`. `PaymentsPort.refund(ref, { key, amountMinor })` gives it back, by invoice or payment reference (`PAYMENTS_NO_PAYMENT` when an invoice holds none). `assertCharge`. A product's own fake of `PaymentsPort` gains the two methods.

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0

## 0.3.0

### Minor Changes

- 13f5fb8: `@krizaka/payments` moves to krizaka-ts (#55), same npm name, 0.2.2 to 0.3.0; krizaka-ui stops publishing it. The processor stays behind `PaymentsPort`. `checkout` takes `discount` (`DiscountTerms`: one processor coupon per `(couponId, termsVersion)`, remembered in `payments.discount`, sent as `discounts` next to automatic tax, never a promotion code), `idempotencyKey`, `metadata` and `expiresAt` (31 minutes to 24 hours), and answers `{ url, checkoutRef, expiresAt }`. Events: `checkout_expired` and `payment_refunded` (cumulative) are translated; `payment_paid` and `subscription_started` carry `checkoutRef`, `paymentRef`, `invoiceRef`, `amountTotal`, `amountDiscount`, `currency`, `metadata`. `applyOnceInTransaction` is the way (record and effect in one transaction, `payments.event`); `adoptPaymentEventsSql` moves a product's `payment_events`; `announcePayment` appends `evt.payment.*.v1` to the outbox. Also: `money`, `formatMoney`, `paymentsSchema`, `@krizaka/payments/settings` (`payments.webhookToleranceSeconds`), `@krizaka/payments/testkit`, `plansFromPrices`, repricing through `transfer_lookup_key`, and the setup's webhook now listens to expired and refunded.
