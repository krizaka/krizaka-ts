# @krizaka/credits

## 0.1.0

### Minor Changes

- 9eb5c92: New package (#56): `@krizaka/credits`, one credits ledger. `createCredits` (`grant` with expiry, daily and monthly caps and `stop` / `fallback_paid`; `purchase`; `consume` from the pots that lapse first, refusing with `CREDITS_CAP_DAY`, `CREDITS_CAP_MONTH`, `CREDITS_EXHAUSTED` or `PAYWALL`; `hold`, `settle`, `release`; `refund`; `expire` and `expireDue`; `adjust`; `balance` and `history`), `creditsSchema` (`credits.grant`, `credits.entry` append-only by trigger, `credits.hold`), `dbCreditStore` with a per-account advisory lock, `memoryCreditStore`, `@krizaka/credits/settings` (`credits.timeZone`, `credits.holdTtlSeconds`), `evt.credit.granted.v1` and `evt.credit.exhausted.v1` through the outbox, and `creditsLedgerContract`.
