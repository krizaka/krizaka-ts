---
"@krizaka/auth": minor
---

`accountsSchema`, `rolesSchema` and `identityLinksSchema`: the accounts, roles and federated-links tables as `@krizaka/db` modules, version 1 byte-identical to `accountsMigration`, `rolesMigration` and `identityLinksMigration` (a product adopts with no DDL change). `Query` is `@krizaka/db`'s, re-exported under the same name. The three migration functions are deprecated (#51).
