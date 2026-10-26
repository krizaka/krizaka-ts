# @krizaka/rate-limit

## 0.1.0

### Minor Changes

- 1018570: New package (#54): `createLimiter` (fixed windows per address and per subject for each action, the semantics of the copies Yomizaka, Akinaza and Kachizaka carried), `memoryLimitStore` and `dbLimitStore` (one atomic upsert in `rate_limit.bucket`, exact under concurrency), `rateLimitSchema`, `RateLimited` (429 with `Retry-After`), `@krizaka/rate-limit/settings` (the limits as `limits.<action>.perIp|perSubject|windowSeconds` settings) and `limitStoreContract`.

### Patch Changes

- Updated dependencies [da6d980]
  - @krizaka/time@0.1.0
