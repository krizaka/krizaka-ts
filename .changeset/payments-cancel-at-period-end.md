---
"@krizaka/payments": minor
---

`subscription_changed` carries `cancelAtPeriodEnd`: true while the subscription is active but will not renew (the customer cancelled; the processor's `cancel_at_period_end`), false once it has ended. A product shows « Ends on <periodEnd> » instead of « Renews on ».
