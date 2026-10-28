---
"@krizaka/storage": minor
---

Provider registry (ADR-005, slice 1): `PROVIDER_KINDS` as data, `openProvider` with the runtime and environment guards (`devOnly` refused in `prod`, `folder` only in `dev`), `PROVINCE_OF_REGION` and `residencyLabel`, `testConnection` and `checkEndpointDns` moved from Yomizaka, and the envelope vault (`sealEnvelope`, `openEnvelope`, `rewrapEnvelope`, `keyIdOf`, `v2.` values with a `key_id`; `v1.` still opens).
