# @krizaka/db

## 0.2.0

### Minor Changes

- 273c554: `defineModule` takes a default Postgres `schema` (`public` for tables that existed before the module schemas, adopted and never moved), and `Query` takes a mutable `unknown[]` of parameters, so an adapter typed the way `pg` types it is accepted as is (#51).

## 0.1.0

### Minor Changes

- bde5c73: First release: the database foundation of the Krizaka modules (ADR-001). Shared `Query`/`Connection`/`Clock` types, `transaction`, frozen and checksummed module schemas (`defineModule`) embedded in the product's own migration sequence (`emitMigration`, `adoptMigration`) with a boot check (`assertModules`), a runner for products without one (`migrate`), and `@krizaka/db/testing` (`createTestDatabase`, `assertEmbedded`, `assertUpgrade`).
