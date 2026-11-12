# @krizaka/mail

## 0.2.0

### Minor Changes

- dc7d617: feat(mail): off production, mail goes only to the test allowlist, and a Mailpit provider. `mail.environment` (default `dev`; only `production` sends to anyone) and `mail.allowlist` (default `test@krizaka.com`, `bonjour@krizaka.com`): off production a recipient outside the list is refused before the provider is called, logged as `not-allowlisted` (hashed), and the subject gets `[test <environment>]`. New `mailpitProvider` (`MAIL_PROVIDER=mailpit`, base URL `mail.mailpitUrl`). `mailSchema` migration 2 adds the status: apply it before deploying. `MailSettings` gains `environment`, `allowlist` and `mailpitUrl`; a product that builds it by hand must set `environment: "production"` to keep sending to everyone.

## 0.1.4

### Patch Changes

- Updated dependencies [a8e1138]
  - @krizaka/settings@0.7.0

## 0.1.3

### Patch Changes

- Updated dependencies [bc85231]
  - @krizaka/settings@0.6.0

## 0.1.2

### Patch Changes

- Updated dependencies [2a7898c]
- Updated dependencies [2272b57]
  - @krizaka/time@0.2.0
  - @krizaka/settings@0.5.2

## 0.1.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.1.0

### Minor Changes

- 8210a9a: New package (#58): `@krizaka/mail`. `createMail` (`queue` in the caller's transaction through the outbox topic `mail`, `deliver` for the worker: suppression and key checks, send, then claim, so a crash sends again rather than loses; `suppress`, `unsuppress`, `purge`), `mailgunProvider`, `resendProvider`, `logProvider` and `providerFor` over an injected `fetch`, `parseMailgunWebhook` and `parseResendWebhook` (signature, age, hard bounces and complaints), `mailSchema` (`mail.delivery`, `mail.suppression` as address hashes, `mail.idempotency`), `dbMailStore`, `memoryMailStore`, `emailPorts` (the three ports of `@krizaka/email`, structurally), `@krizaka/mail/settings` (`mail.provider`, `mail.from`, `mail.replyTo`, `mail.retentionDays`), `evt.mail.requested.v1` and `mailStoreContract`.
  
  `@krizaka/settings` gains the `text` kind (`text(group, default, { max, empty })`): one trimmed line of free text, for an address or a name.

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0
