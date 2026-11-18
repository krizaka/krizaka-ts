---
"@krizaka/storage": minor
---

One master key and a sealed data key per tenant, proved: a tenant's data key cannot open another tenant's object, rotating the master key re-wraps the data keys without rewriting any object, and KMS calls per document are bounded by the data-key cache (measured against the `local` key adapter, no cloud account).
