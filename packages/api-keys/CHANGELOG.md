# @krizaka/api-keys

## 0.3.0

### Minor Changes

- 273c554: `apiKeysSchema`: the table of API keys as a `@krizaka/db` module, version 1 byte-identical to `apiKeysMigration`'s SQL (a product adopts with no DDL change). `Query` and `Clock` are `@krizaka/db`'s, re-exported under the same names. `apiKeysMigration` is deprecated (#51).

### Patch Changes

- Updated dependencies [273c554]
  - @krizaka/db@0.2.0

## 0.2.0

### Minor Changes

- 5c6d9a6: Functional names for the technology-named exports (#30): `dbAccounts`, `dbApiKeyStore`, `dbSettings` (and the type `DbSettingsDeps`). The old `postgresAccounts`, `pgApiKeyStore`, `postgresSettings` and `PostgresSettingsDeps` stay as `@deprecated` aliases for this minor and go in the next major: move to the new names now.

## 0.1.0

### Minor Changes

- c54f5e5: First release, extracted from Yomizaka: create, rotate (with a grace period), revoke and authenticate API keys behind a store port; memory and PostgreSQL stores, the migration, and the store contract kit.
