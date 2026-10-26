# @krizaka/api-keys

## 0.2.0

### Minor Changes

- 5c6d9a6: Functional names for the technology-named exports (#30): `dbAccounts`, `dbApiKeyStore`, `dbSettings` (and the type `DbSettingsDeps`). The old `postgresAccounts`, `pgApiKeyStore`, `postgresSettings` and `PostgresSettingsDeps` stay as `@deprecated` aliases for this minor and go in the next major: move to the new names now.

## 0.1.0

### Minor Changes

- c54f5e5: First release, extracted from Yomizaka: create, rotate (with a grace period), revoke and authenticate API keys behind a store port; memory and PostgreSQL stores, the migration, and the store contract kit.
