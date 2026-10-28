---
"@krizaka/storage": minor
---

Providers in the database (ADR-005, slice 2), in `@krizaka/storage/provider-admin`: `storageSchema`, `dbProviderStore` / `memoryProviderStore` with a contract, `createProviderService` (create, test, set default, change key, disable, retire, rotate the vault key, bootstrap from the environment; secrets returned as set / not set, every change audited), `moveBatch` (SHA-256-verified move) and `readDual` (reads from both stores during a move).
