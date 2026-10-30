# @krizaka/settings

## 0.5.2

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.

## 0.5.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0

## 0.5.0

### Minor Changes

- 8210a9a: New package (#58): `@krizaka/mail`. `createMail` (`queue` in the caller's transaction through the outbox topic `mail`, `deliver` for the worker: suppression and key checks, send, then claim, so a crash sends again rather than loses; `suppress`, `unsuppress`, `purge`), `mailgunProvider`, `resendProvider`, `logProvider` and `providerFor` over an injected `fetch`, `parseMailgunWebhook` and `parseResendWebhook` (signature, age, hard bounces and complaints), `mailSchema` (`mail.delivery`, `mail.suppression` as address hashes, `mail.idempotency`), `dbMailStore`, `memoryMailStore`, `emailPorts` (the three ports of `@krizaka/email`, structurally), `@krizaka/mail/settings` (`mail.provider`, `mail.from`, `mail.replyTo`, `mail.retentionDays`), `evt.mail.requested.v1` and `mailStoreContract`.
  
  `@krizaka/settings` gains the `text` kind (`text(group, default, { max, empty })`): one trimmed line of free text, for an address or a name.

## 0.4.0

### Minor Changes

- 273c554: `settingsSchema` and `pricesSchema`: the settings and price tables as `@krizaka/db` modules, version 1 byte-identical to `settingsMigration` and `pricesMigration` (a product adopts with no DDL change). `Query` is `@krizaka/db`'s, re-exported under the same name. The two migration functions are deprecated (#51).

### Patch Changes

- Updated dependencies [273c554]
  - @krizaka/db@0.2.0

## 0.3.0

### Minor Changes

- 5c6d9a6: Functional names for the technology-named exports (#30): `dbAccounts`, `dbApiKeyStore`, `dbSettings` (and the type `DbSettingsDeps`). The old `postgresAccounts`, `pgApiKeyStore`, `postgresSettings` and `PostgresSettingsDeps` stay as `@deprecated` aliases for this minor and go in the next major: move to the new names now.

## 0.2.0

### Minor Changes

- 7165f38: The price catalogue (ADR-009): `definePrices` (typed entries — unit, cents or « on quote », CAD, before taxes, availability, named limits), `priceCatalogue` (entry at a date, versions a subscription keeps, `schedule` from a date with an audit line, history, upcoming), `publicCatalogue`, `findTypedPrices`, `describePrices`, `priceStore` over PostgreSQL (`pricesMigration`) and `memoryPriceStore`.

## 0.1.0

### Minor Changes

- 8e09725: First release: the typed registry, resolution user > workspace > global > default, the audit of every change, the admin description, the PostgreSQL adapter and its migration.
