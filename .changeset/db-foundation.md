---
"@krizaka/db": minor
---

First release: the database foundation of the Krizaka modules (ADR-001). Shared `Query`/`Connection`/`Clock` types, `transaction`, frozen and checksummed module schemas (`defineModule`) embedded in the product's own migration sequence (`emitMigration`, `adoptMigration`) with a boot check (`assertModules`), a runner for products without one (`migrate`), and `@krizaka/db/testing` (`createTestDatabase`, `assertEmbedded`, `assertUpgrade`).
