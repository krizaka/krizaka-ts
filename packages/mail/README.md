# @krizaka/mail

Mail for every Krizaka product: queued in the caller's transaction through `@krizaka/outbox`, delivered once per idempotency key, never to a suppressed address, with the provider the admin chose. No vendor SDK, no environment variable, no wall clock, no database client.

- **It takes mail already rendered.** Templates are `@krizaka/email`'s (a UI package this one never imports). `emailPorts(store, clock)` gives `@krizaka/email` its three ports (`DeliveryLog`, `SuppressionList`, `IdempotencyStore`) over the same tables, so a direct `sendEmail` and the queue share one log, one suppression list and one set of keys.
- **At least once, never lost.** `deliver` checks the suppression list, checks the key, sends, and only then claims the key: a crash between the send and the claim sends again (a duplicate reset mail beats a lost one); a redelivery after the claim is a no-op.
- **Addresses are hashed** (SHA-256 of the normal form) in the suppression list and in the delivery log. The queued message holds the address until the outbox purges it.
- **Providers** are adapters over an injected `fetch`: `mailgunProvider`, `resendProvider`, `logProvider` (development, writes no body). `providerFor(settings.provider, keys, fetch, write)` picks the one the admin chose and refuses a provider without its key instead of falling back to `log`.
- **Bounces and complaints** come back through the provider's signed webhook: `parseMailgunWebhook` and `parseResendWebhook` verify the signature and the age, and answer the addresses to suppress (a permanent failure or hard bounce, a complaint, an unsubscribe). A transient bounce is ignored.
- **The admin's settings** (`@krizaka/mail/settings`): `mail.provider` (`log`, `mailgun`, `resend`), `mail.from`, `mail.replyTo`, `mail.retentionDays`. Keys, the Mailgun domain and the webhook signing keys stay in the environment (`MAIL_PROVIDER`-style names, read by the product and passed in).

```ts
import { createOutbox, runWorker } from "@krizaka/outbox";
import { createMail, dbMailStore, MAIL_TOPIC, providerFor } from "@krizaka/mail";
import { mailSettings, readMailSettings } from "@krizaka/mail/settings";

const mail = createMail({
  clock,
  outbox: createOutbox({ clock, settings: outboxSettings }),
  settings: () => readMailSettings((key) => settings.get(key)),
  store: dbMailStore(query),
  provider: (s) => providerFor(s.provider, { apiKey: env.MAIL_API_KEY, domain: env.MAIL_DOMAIN }, fetch, console.log),
});

// in the use case's transaction: the mail leaves only if the transaction commits
await mail.queue(tx, { to, subject, text, category: "transactional", template: "password-reset", locale: "fr", idempotencyKey: `reset:${resetId}` });

// in the worker process
await runWorker({ outbox, query, owner, topic: MAIL_TOPIC, deliver: (m) => mail.deliver(m).then(() => undefined), sleep });

// in the webhook route
const suppression = parseMailgunWebhook(rawBody, env.MAIL_WEBHOOK_SIGNING_KEY, nowSeconds);
if (suppression) await mail.suppress(suppression);
```

Tables (schema `mail`, `mailSchema`): `delivery`, `suppression`, `idempotency`. Event: `evt.mail.requested.v1` on topic `mail`. `mailStoreContract` (`@krizaka/mail/testkit`) is the contract every store runs.

Apache-2.0.
