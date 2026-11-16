---
"@krizaka/resilience": minor
---

New package: `withTimeout` (whole call and first byte), `retrying` (full-jitter backoff, `Retry-After`, retry predicate, token-bucket budget) and `createCircuit`, lifted from `@krizaka/sovkora-client`. Clock, sleep, timer and random are injected.
