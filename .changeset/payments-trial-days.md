---
"@krizaka/payments": minor
---

A subscription checkout can start with free days (`CheckoutRequest.trialDays`, the processor's trial, 1 to 730 whole days, refused on a one-off payment), and the adapter declares `capabilities.trial` so a product refuses to promise free days on an adapter that would drop them. The product decides who gets a trial and in which mode of the processor.
