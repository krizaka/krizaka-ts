# @krizaka/webhooks

Signed and idempotent webhooks, both ways.

**Out.** An owner registers endpoints (`https`, public host; the secret is shown once and kept sealed); the product `emit`s an event with a stable id, which is queued **once per endpoint** however often it is emitted; `deliverDue` sends what is due, signed (`x-krizaka-signature: t=<s>,v1=<hmac of "<t>.<body>">`), retries with a backoff, gives up after `maxAttempts` and keeps the log (`deliveries`).

**In.** `receiveWebhook` verifies the signature over the raw body (with a replay window), records the event id first, applies once; a replay is `"duplicate"`; if applying throws, the record is removed so the sender's retry applies it.

```ts
import { createWebhooks, webhooksMigration, receiveWebhook } from "@krizaka/webhooks";

await db.query(webhooksMigration("accounts")); // once, in your migrations (idempotent)
const hooks = createWebhooks({ query, rules: { events: ["booking.created", "invoice.paid"], maxAttempts: 6, backoffSeconds: [30, 300, 1800, 7200, 43200] }, secrets: { seal, open } });
await hooks.emit(ownerId, { id: `booking:${id}`, type: "booking.created", payload }, now);
await hooks.deliverDue(now, send); // from a tick: `send` is your fetch (no redirects, short timeout, refuses private addresses)
```

The product keeps: the HTTP call (`send`), sealing the secret, when `deliverDue` runs, the quota per plan, its audit and its routes. Nothing here reads the clock.
