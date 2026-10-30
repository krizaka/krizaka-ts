# @krizaka/privacy

## 0.2.2

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.
- Updated dependencies [2a7898c]
- Updated dependencies [2272b57]
  - @krizaka/time@0.2.0
  - @krizaka/settings@0.5.2

## 0.2.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.2.0

### Minor Changes

- 9629401: The confidentiality incident register (Loi 25, ss. 3.5 to 3.8): `createIncidentRegister` (open, assess the risk of serious injury, record measures and the notices to the Commission and the people concerned, close, list and export the register by scope), `suggestSeriousInjury`, `registerToCsv`, `memoryIncidentStore` / `dbIncidentStore`, `incidentStoreContract` (testkit) and migration 2 of `privacySchema` (`privacy.incident`: an entry is kept five years from the day the enterprise became aware, and a closed entry is never edited).

## 0.1.1

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0

## 0.1.0

### Minor Changes

- e2e5ea3: New package (#59): privacy (Loi 25). Consents by purpose written once (a trigger refuses updates) with the notice version shown; `PrivacyContributor`, the port every module implements; `exportSubject` (one document, a part per contributor) and `requestExport` / `fulfilExport` (large exports through the outbox); `eraseSubject` (every contributor in one transaction, consents withdrawn, a request and an audit entry that name no one); `purge` with a retention per purpose; `auditContributor`; `privacySchema`; `@krizaka/privacy/settings` (`privacy.retention.<purpose>Days`) and `privacyStoreContract`.

### Patch Changes

- Updated dependencies [da6d980]
  - @krizaka/time@0.1.0
