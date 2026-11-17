# @krizaka/resilience

## 0.1.0

### Minor Changes

- 2bf7686: New package: `withTimeout` (whole call and first byte), `retrying` (full-jitter backoff, `Retry-After`, retry predicate, token-bucket budget) and `createCircuit`, lifted from `@krizaka/sovkora-client`. Clock, sleep, timer and random are injected.
