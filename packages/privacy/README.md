# @krizaka/privacy

Privacy for every Krizaka product (Loi 25): **consents by purpose**, the person's data **exported** from every module that holds it, **erased** from every module in one transaction, and **retention** per purpose set by the admin. Six products had a partial copy (Yomizaka's consents, export and delete; Akinaza's `recordConsent` and `eraseClient`; the asynchronous export and the admin exports the products carried; the consent columns). This is the one version.

```ts
import { transaction } from "@krizaka/db";
import { auditContributor, createPrivacy, privacySchema } from "@krizaka/privacy";
import { privacySettings, retentionFromSettings } from "@krizaka/privacy/settings";

emitMigration(privacySchema, 1, { tables: {} }); // commit the SQL once, in your migrations: privacy.consent and privacy.request

const privacy = createPrivacy({
  clock: { now: () => new Date() },
  purposes: ["marketing", "screening"],                 // the purposes the product declares
  contributors: [auditContributor(audit), ordersContributor, filesContributor], // every module that holds personal data
  transaction: (work) => transaction(connect, work),
  retentionDays: retentionFromSettings((key) => settings.get(key)), // privacy.retention.<purpose>Days
  audit, outbox,                                         // optional: the erasure is recorded; a large export goes through the outbox
});

const eric = { kind: "account", id: account.id };         // a subject is a kind and an id: an account, a client file, an application
await privacy.recordConsent(query, { subject: eric, purpose: "marketing", version: "2026-10-01", granted: true, means: "checkbox" });
await privacy.hasConsent(query, eric, "marketing");       // the consent with the last word; never having said anything is a no
const document = await privacy.exportSubject(query, eric); // { format: 1, subject, generatedAt, modules: { audit, orders, files } }
await privacy.eraseSubject(eric);                         // every contributor, one transaction, consents withdrawn, a record without personal data
await privacy.purge(query);                               // from the product's job: what is past each purpose's retention
```

- **A subject is a kind and an id**, not necessarily an account: Akinaza's data subject is a client file, Yomizaka's a tenant on an application.
- **`privacy.consent` is written once**: a trigger refuses every update; a withdrawal is a new row; the row with the last `seq` wins. Each consent holds the **version of the notice shown**, the means and the instant: the proof of what the person agreed to.
- **`PrivacyContributor`** is the port every module implements: `exportFor(query, subject)`, `eraseFor(tx, subject)` (erase or anonymise through the transaction it is given: a module that keeps an invoice for six years blanks the name and keeps the row), and optionally `purgeExpired(tx, { purpose, before })`. The product registers one for its own tables. `auditContributor(audit)` is provided for `@krizaka/audit` (the export lists the actor's entries; the erasure detaches them and keeps the facts). A side effect outside the database (a file in storage) is not done in `eraseFor`: append it to the outbox in the same transaction.
- **Export** assembles one JSON document with a part per contributor; a contributor that fails fails the export, naming it (a silent omission would be a lie). **A large export** is asked in the caller's transaction with `requestExport(tx, subject)` (it appends `evt.privacy.export_requested.v1` to the outbox, holding the request id only) and a worker calls `fulfilExport(query, requestId, deliver)`: the asynchronous mode.
- **Erasure** runs every contributor's `eraseFor` in ONE transaction, withdraws the live consents (a new row each, version `erasure` or the one you pass), records the request and an audit entry `privacy.erasure_completed` that names the request and the modules and **no one**. If a contributor fails, nothing is erased, the request is recorded as `failed` with a code, and the error is thrown (if recording the failure fails too, an `AggregateError` with the original first).
- **Retention:** `privacySettings({ screening: { retentionDays: 365 } })` (`@krizaka/privacy/settings`, needs `@krizaka/settings` and `zod`) declares `privacy.retention.screeningDays` (`payment-history` → `paymentHistoryDays`). `purge` calls every contributor's `purgeExpired` for each purpose that has a retention.
- The request table holds an id of the subject and no other personal data, so it can outlive the erasure it proves. `privacyStoreContract` (from `@krizaka/privacy/testkit`) is the contract every store runs.

## Confidentiality incident register

The register that the Act respecting the protection of personal information in the private sector ([CQLR c. P-39.1](https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1), ss. 3.5 to 3.8) asks every enterprise to keep, with the content and retention set by the [Regulation respecting confidentiality incidents](https://www.legisquebec.gouv.qc.ca/en/document/cr/P-39.1,%20r.%203.1). In short, as we read it (not legal advice): on reason to believe an incident occurred, reduce the risk and prevent a new one; assess the risk of serious injury from the sensitivity of the information, the anticipated consequences and the likelihood of misuse; if the risk is serious, notify the Commission d'accès à l'information and the people concerned promptly; and keep a register of every incident, serious or not, for at least five years after becoming aware of it, handed to the Commission on request.

```ts
import { createIncidentRegister, registerToCsv, suggestSeriousInjury } from "@krizaka/privacy";

emitMigration(privacySchema, 2, { tables: {} });            // privacy.incident (after version 1)
const incidents = createIncidentRegister({ clock: { now: () => new Date() }, audit });
const admin = { id: account.id, label: account.name };

const { id } = await incidents.open(query, { scope: tenantId, kind: "access", description: "…", information: ["lease"], personsConcerned: 3 }, admin);
await incidents.recordMeasure(query, tenantId, id, "Session revoked", admin);
await incidents.assess(query, tenantId, id, { sensitivity: "high", consequences: "high", likelihood: "medium", seriousInjury: suggestSeriousInjury(factors), rationale: "…" }, admin);
await incidents.recordNotice(query, tenantId, id, "cai", { channel: "form" }, admin);     // and "persons"
await incidents.close(query, tenantId, id, admin);       // a serious injury closes once both notices are recorded
registerToCsv((await incidents.exportRegister(query, tenantId)).entries);
```

- **Every call is by `scope`** (the tenant): an entry of another scope is never found, edited or exported. The store is the `IncidentStore` port (`memoryIncidentStore`, `dbIncidentStore`; `incidentStoreContract` from `@krizaka/privacy/testkit`); the clock is injected.
- **The register holds no personal data of the people concerned**: how many, and the categories of information, never the information.
- **Kept five years**: `retainUntil` is five years after `awareAt`; the database refuses to delete an entry before it, and refuses to edit a closed one. A drill is marked (`drill`) and stays in the register.
- `suggestSeriousInjury` is a guide for the person in charge; the decision (`seriousInjury`) is theirs and is recorded with its rationale. An incident without serious injury owes no notice (`recordNotice` refuses).
- With `audit`, each step is traced as `privacy.incident_*` without the description or any person.
