# @krizaka/webhooks

## 0.3.5

### Patch Changes

- 79a6d53: SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.
- Updated dependencies [79a6d53]
  - @krizaka/payments@0.7.3

## 0.3.4

### Patch Changes

- Updated dependencies [6bd4b0f]
  - @krizaka/payments@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [089100a]
  - @krizaka/payments@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [70687cc]
  - @krizaka/payments@0.5.0

## 0.3.1

### Patch Changes

- 97106c5: Depends on `@krizaka/payments` through `workspace:^` (it was `^0.1.0`, which stopped matching the repository when payments reached 0.4.0 and stopped `changeset version`).
- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/payments@0.4.1

## 0.3.0

### Minor Changes

- 273c554: `webhooksSchema`: the webhooks tables as a `@krizaka/db` module, version 1 byte-identical to `webhooksMigration`'s SQL (a product adopts with no DDL change). `Query` is `@krizaka/db`'s, re-exported under the same name. `webhooksMigration` is deprecated (#51).

### Patch Changes

- Updated dependencies [273c554]
  - @krizaka/db@0.2.0

## 0.2.0

### Minor Changes

- 2dc4032: Signing and verification are `@krizaka/payments`' own (one implementation of the scheme, no copy).

## 0.1.0

### Minor Changes

- 39c4656: First release: signatures and their verification, the endpoint address rules, outgoing endpoints / queue / delivery with retries and a log, incoming events applied once, the PostgreSQL migration.
