# @krizaka/audit

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
