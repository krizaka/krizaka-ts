# @krizaka/contract

## 0.1.0

### Minor Changes

- 1e898dc: First release: `defineContract`, `expectContract`, `expectProviderAnswer`, `assertContract` and `fetchContract` assert one zod response schema in route tests, journeys, monitors and runtime fetch wrappers. A non-2xx, a 204 or empty body, non-JSON, a missing field, an undefined or NaN value, an empty string or an empty list fails with the field's path (never its value). Refs krizaka-internal#1971.
