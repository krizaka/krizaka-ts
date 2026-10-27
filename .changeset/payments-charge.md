---
"@krizaka/payments": minor
---

One-off per-item charge (#132): `PaymentsPort.charge({ key, customerId, amountMinor, currency, description, taxCode })` makes one invoice with one taxed line (Stripe Tax, tax behaviour exclusive), finalises and pays it with the saved payment method, every call keyed by `key`; a declined payment voids the invoice and throws `PAYMENTS_DECLINED`. `PaymentsPort.refund(ref, { key, amountMinor })` gives it back, by invoice or payment reference (`PAYMENTS_NO_PAYMENT` when an invoice holds none). `assertCharge`. A product's own fake of `PaymentsPort` gains the two methods.
