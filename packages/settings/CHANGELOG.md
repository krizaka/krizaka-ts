# @krizaka/settings

## 0.2.0

### Minor Changes

- 7165f38: The price catalogue (ADR-009): `definePrices` (typed entries — unit, cents or « on quote », CAD, before taxes, availability, named limits), `priceCatalogue` (entry at a date, versions a subscription keeps, `schedule` from a date with an audit line, history, upcoming), `publicCatalogue`, `findTypedPrices`, `describePrices`, `priceStore` over PostgreSQL (`pricesMigration`) and `memoryPriceStore`.

## 0.1.0

### Minor Changes

- 8e09725: First release: the typed registry, resolution user > workspace > global > default, the audit of every change, the admin description, the PostgreSQL adapter and its migration.
