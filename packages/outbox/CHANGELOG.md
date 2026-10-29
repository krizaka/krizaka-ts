# @krizaka/outbox

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

- cfd2511: New package (#53): the transactional outbox. `createOutbox` (`append(tx, …)` in the caller's transaction, `claim` with a lease over `FOR UPDATE SKIP LOCKED`, `complete`, `fail` with a doubling capped back-off then a dead letter, `retryDead`, `purge`, `stats`), `drainOnce` and `runWorker` (no timer of its own: the product passes `sleep`), `consumeOnce` (the idempotent consumer, in the effect's transaction), `memoryOutboxStore`, `dbOutboxStore`, `outboxSchema`, `@krizaka/outbox/settings` (`outbox.batchSize`, `leaseSeconds`, `maxAttempts`, `backoffSeconds`, `backoffMaxSeconds`, `retentionDays`) and `outboxStoreContract`. At least once: consumers are idempotent on the message id.

### Patch Changes

- Updated dependencies [da6d980]
  - @krizaka/time@0.1.0
