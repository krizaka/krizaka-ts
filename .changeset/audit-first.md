---
"@krizaka/audit": minor
---

First release: the audit trail of the Krizaka modules (ADR-001 module 2). An append-only `audit.entry` in its own schema (embedded through `@krizaka/db`), `record` inside the caller's transaction or `recordQuietly` beside it, filters and cursor pages for the admin, Loi 25 export and redaction, retention from the `audit.retentionDays` setting, a memory store and a contract kit.
