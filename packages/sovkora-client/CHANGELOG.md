# @krizaka/orazaka-client

## 1.0.0

### Major Changes

- a8e1138: No retired code name anywhere (founder, 2026-11-06, krizaka-internal#2659).
  
  - `@krizaka/org` 1.0.0: brand ids are the commercial names (`verikora`, `folioviv`, `sovkora`, `kridoc`); `OrgBrand.codeName` becomes `id`, `formerly` is gone; `CODE_NAMES` is the historic table (retired → id) and `brandOf(<retired>)` throws; `findCodeNames` and the `krizaka-code-names` bin refuse the retired names everywhere, in any case, with no allowed span (history: `CHANGELOG.md` is skipped); `org.products`, `org.family`, `apps/<id>.json` and `CastProduct` use the new ids; every product's runtime config points at `https://dev.<product>.com`.
  - `@krizaka/sovkora-client` replaces the engine client published under its former code name (deprecated): `createSovkoraClient`, `SovkoraClient`, `SovkoraError`, `SOVKORA_CODE` with `SOVKORA_*` codes.
  - `@krizaka/settings`: `displayNameSetting(id)` and the brand checks take the new ids. `@krizaka/config`: `no-hand-typed-family-name` names the products by their commercial names.

## 0.2.1

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.

## 0.2.0

### Minor Changes

- 1e8b3a4: New: `startCheck(purpose, { subject, consented, runId })` and `collectCheck(providerRef, { subjectId, consented })`, the calls of Orazaka's HTTP door for external checks (`POST /api/v1/checks/{court-records|credit}`, `GET /api/v1/checks/{providerRef}`; orazaka-ai-engine#105). The answer is the closed `CheckResult` (outcome, refusal, category, providerRef): a refusal (`NO_CONSENT`, `NO_KEY`, `BUDGET_EXHAUSTED`, `NOT_CONFIGURED`) is a result, never an exception; 401/403/404/429 map to the existing stable codes. Exports the check types, constants and `parseCheck`.

## 0.1.0

### Minor Changes

- 7e74a92: New: `@krizaka/orazaka-client`, the one Orazaka client for the TypeScript products (#33). Start a Studio run (idempotency key), read its status and outputs, wait for it; typed errors with stable codes, a time limit and a circuit breaker as options; base URL, key and clock as parameters; a fixture-based contract test.
