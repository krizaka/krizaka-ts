---
"@krizaka/db": minor
---

`defineModule` takes a default Postgres `schema` (`public` for tables that existed before the module schemas, adopted and never moved), and `Query` takes a mutable `unknown[]` of parameters, so an adapter typed the way `pg` types it is accepted as is (#51).
