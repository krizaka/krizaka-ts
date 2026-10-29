# @krizaka/credits

## 0.1.3

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.
- Updated dependencies [2a7898c]
- Updated dependencies [2272b57]
  - @krizaka/time@0.2.0
  - @krizaka/settings@0.5.2

## 0.1.2

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.1.1

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0

## 0.1.0

### Minor Changes

- 9eb5c92: New package (#56): `@krizaka/credits`, one credits ledger. `createCredits` (`grant` with expiry, daily and monthly caps and `stop` / `fallback_paid`; `purchase`; `consume` from the pots that lapse first, refusing with `CREDITS_CAP_DAY`, `CREDITS_CAP_MONTH`, `CREDITS_EXHAUSTED` or `PAYWALL`; `hold`, `settle`, `release`; `refund`; `expire` and `expireDue`; `adjust`; `balance` and `history`), `creditsSchema` (`credits.grant`, `credits.entry` append-only by trigger, `credits.hold`), `dbCreditStore` with a per-account advisory lock, `memoryCreditStore`, `@krizaka/credits/settings` (`credits.timeZone`, `credits.holdTtlSeconds`), `evt.credit.granted.v1` and `evt.credit.exhausted.v1` through the outbox, and `creditsLedgerContract`.
