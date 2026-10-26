---
"@krizaka/privacy": minor
---

New package (#59): privacy (Loi 25). Consents by purpose written once (a trigger refuses updates) with the notice version shown; `PrivacyContributor`, the port every module implements; `exportSubject` (one document, a part per contributor) and `requestExport` / `fulfilExport` (large exports through the outbox); `eraseSubject` (every contributor in one transaction, consents withdrawn, a request and an audit entry that name no one); `purge` with a retention per purpose; `auditContributor`; `privacySchema`; `@krizaka/privacy/settings` (`privacy.retention.<purpose>Days`) and `privacyStoreContract`.
