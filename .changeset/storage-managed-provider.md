---
"@krizaka/storage": minor
---

The managed provider kind (ADR-020): any S3-compatible bucket plus a KMS (`okms`, `aws-kms`, `local` in development), entered by the admin and sealed, with one encrypted store per tenant (`forTenant`) and a probe store for the connection test; `managedResidency` with the declared replica; the admin's controls in `@krizaka/storage/settings` (`managedStorageSettings`, `resolveManagedPolicy` tenant > plan > product > global, `providerAllowed`, `linkSeconds`, `MANAGED_PRICE_IDS`); OVHcloud Toronto and Google Cloud's Canadian regions in the region table; the Google Cloud Storage interoperability preset; `memoryKeyService({ root })`.
