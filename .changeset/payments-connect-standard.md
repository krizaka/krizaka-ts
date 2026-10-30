---
"@krizaka/payments": minor
---

Stripe Connect Standard for products whose customers are merchants: `connectAdapter` (connected-account creation, Stripe-hosted onboarding link, account status, customers and SetupIntent card-saving on the connected account, direct charges and deposit holds with capture or release, refunds capped at what was paid, optional application fee), and `handleConnectWebhook`, the one platform Connect webhook (signature verified, events routed by `account`, applied once, handlers are the only writers of paid / refunded). Integer cents, injected clock, typed `PaymentsError` codes, no card data in any input, and the library never reads env.
