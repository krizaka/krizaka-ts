# @krizaka/audit

## 0.1.8

### Patch Changes

- 79a6d53: SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.
- Updated dependencies [79a6d53]
  - @krizaka/settings@0.7.1

## 0.1.7

### Patch Changes

- Updated dependencies [a8e1138]
  - @krizaka/settings@0.7.0

## 0.1.6

### Patch Changes

- Updated dependencies [bc85231]
  - @krizaka/settings@0.6.0

## 0.1.5

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [273c554]
- Updated dependencies [273c554]
  - @krizaka/db@0.2.0
  - @krizaka/settings@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [5c6d9a6]
  - @krizaka/settings@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [7165f38]
  - @krizaka/settings@0.2.0

## 0.1.0

### Minor Changes

- d33c012: First release: the audit trail of the Krizaka modules (ADR-001 module 2). An append-only `audit.entry` in its own schema (embedded through `@krizaka/db`), `record` inside the caller's transaction or `recordQuietly` beside it, filters and cursor pages for the admin, Loi 25 export and redaction, retention from the `audit.retentionDays` setting, a memory store and a contract kit.
