---
"@krizaka/storage": minor
---

Add the `MalwareScanner` and `EventSource` ports (ClamAV daemon adapter, in-memory adapters, idempotent event handling) and `presignUpload`, a size-bounded S3 POST policy on `bucketStore` (`null` on stores that cannot bound it). Proved against MinIO and clamd in CI.
