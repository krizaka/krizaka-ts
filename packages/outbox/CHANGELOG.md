# @krizaka/outbox

## 0.1.0

### Minor Changes

- cfd2511: New package (#53): the transactional outbox. `createOutbox` (`append(tx, …)` in the caller's transaction, `claim` with a lease over `FOR UPDATE SKIP LOCKED`, `complete`, `fail` with a doubling capped back-off then a dead letter, `retryDead`, `purge`, `stats`), `drainOnce` and `runWorker` (no timer of its own: the product passes `sleep`), `consumeOnce` (the idempotent consumer, in the effect's transaction), `memoryOutboxStore`, `dbOutboxStore`, `outboxSchema`, `@krizaka/outbox/settings` (`outbox.batchSize`, `leaseSeconds`, `maxAttempts`, `backoffSeconds`, `backoffMaxSeconds`, `retentionDays`) and `outboxStoreContract`. At least once: consumers are idempotent on the message id.

### Patch Changes

- Updated dependencies [da6d980]
  - @krizaka/time@0.1.0
