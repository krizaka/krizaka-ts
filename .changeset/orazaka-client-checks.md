---
"@krizaka/orazaka-client": minor
---

New: `startCheck(purpose, { subject, consented, runId })` and `collectCheck(providerRef, { subjectId, consented })`, the calls of Orazaka's HTTP door for external checks (`POST /api/v1/checks/{court-records|credit}`, `GET /api/v1/checks/{providerRef}`; orazaka-ai-engine#105). The answer is the closed `CheckResult` (outcome, refusal, category, providerRef): a refusal (`NO_CONSENT`, `NO_KEY`, `BUDGET_EXHAUSTED`, `NOT_CONFIGURED`) is a result, never an exception; 401/403/404/429 map to the existing stable codes. Exports the check types, constants and `parseCheck`.
