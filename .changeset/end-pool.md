---
"@krizaka/db": minor
---

`@krizaka/db/testing` has `endPool(pool)`: it ends a `pg` pool and waits until the sockets are really closed, so a `DROP DATABASE … WITH (FORCE)` right after no longer kills a live backend (57P01, the flake of akinaza#518 and yomizaka's integration tests). Without it, the helper had to be copied in each product.
