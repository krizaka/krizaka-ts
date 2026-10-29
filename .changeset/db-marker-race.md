---
"@krizaka/db": patch
---

Two packages migrating at the same moment no longer race on the marker table (#241): the emitted SQL and `migrate`'s history table take a fixed transaction-scoped advisory lock before `CREATE TABLE IF NOT EXISTS` (not atomic in PostgreSQL, 23505 on `pg_type`). The test runs eight concurrent migrations on a fresh database.
