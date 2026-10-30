# @krizaka/orazaka-client

## 0.2.1

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.

## 0.2.0

### Minor Changes

- 1e8b3a4: New: `startCheck(purpose, { subject, consented, runId })` and `collectCheck(providerRef, { subjectId, consented })`, the calls of Orazaka's HTTP door for external checks (`POST /api/v1/checks/{court-records|credit}`, `GET /api/v1/checks/{providerRef}`; orazaka-ai-engine#105). The answer is the closed `CheckResult` (outcome, refusal, category, providerRef): a refusal (`NO_CONSENT`, `NO_KEY`, `BUDGET_EXHAUSTED`, `NOT_CONFIGURED`) is a result, never an exception; 401/403/404/429 map to the existing stable codes. Exports the check types, constants and `parseCheck`.

## 0.1.0

### Minor Changes

- 7e74a92: New: `@krizaka/orazaka-client`, the one Orazaka client for the TypeScript products (#33). Start a Studio run (idempotency key), read its status and outputs, wait for it; typed errors with stable codes, a time limit and a circuit breaker as options; base URL, key and clock as parameters; a fixture-based contract test.
