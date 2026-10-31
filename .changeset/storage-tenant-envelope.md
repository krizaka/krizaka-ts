---
"@krizaka/storage": minor
---

Per-tenant envelope encryption for the managed document storage (ADR-020 Decision 3): the `KeyService` KMS port with `memoryKeyService` and `cloudKeyService` (`aws-kms`, `okms`), `tenantVault` (a KEK per tenant kept wrapped in the database, a DEK per object version, AES-256-GCM), `tenantStore` (an `ObjectStore` under `t/<tenantId>/`), tenant and root rotation with an idempotent rewrap, `shredTenant` (crypto-shredding), `dbTenantKeyStore` on `storageSchema` v2, and the `keyServiceContract` / `tenantKeyStoreContract` test kits.
