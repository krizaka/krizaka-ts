# @krizaka/rate-limit

## 0.2.0

### Minor Changes

- 2f05dfc: `@krizaka/rate-limit/turnstile`: `createTurnstileVerifier` checks a Cloudflare Turnstile token server-side (siteverify) and fails closed: no secret, no token, a refusal, a wrong hostname or action, a replayed token, a timeout or an unreachable service all refuse. Single-use, injected clock and fetch (krizaka-com#464).

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

- 1018570: New package (#54): `createLimiter` (fixed windows per address and per subject for each action, the semantics of the copies Yomizaka, Akinaza and Kachizaka carried), `memoryLimitStore` and `dbLimitStore` (one atomic upsert in `rate_limit.bucket`, exact under concurrency), `rateLimitSchema`, `RateLimited` (429 with `Retry-After`), `@krizaka/rate-limit/settings` (the limits as `limits.<action>.perIp|perSubject|windowSeconds` settings) and `limitStoreContract`.

### Patch Changes

- Updated dependencies [da6d980]
  - @krizaka/time@0.1.0
