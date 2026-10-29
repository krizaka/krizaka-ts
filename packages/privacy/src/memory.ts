import type { ConsentRecord, PrivacyRequest, PrivacyStore, Subject } from "./port";

const sameSubject = (a: Subject, b: Subject) => a.kind === b.kind && a.id === b.id;

/** An in-memory store, for unit tests and demos (the same behaviour as the database's: the contract kit runs on both). */
export function memoryPrivacyStore(): PrivacyStore {
  const consents: ConsentRecord[] = [];
  const requests = new Map<string, PrivacyRequest>();
  return {
    async insertConsent(c) {
      consents.push(structuredClone(c));
    },
    async latestConsent(subject, purpose) {
      const found = consents.filter((c) => sameSubject(c.subject, subject) && c.purpose === purpose).at(-1);
      return found ? structuredClone(found) : null;
    },
    async consentHistory(subject) {
      return consents.filter((c) => sameSubject(c.subject, subject)).map((c) => structuredClone(c));
    },
    async insertRequest(r) {
      requests.set(r.id, structuredClone(r));
    },
    async getRequest(id) {
      const found = requests.get(id);
      return found ? structuredClone(found) : null;
    },
    async finishRequest(id, outcome) {
      const found = requests.get(id);
      if (found)
        Object.assign(found, { status: outcome.status, completedAt: outcome.at, failure: outcome.failure ?? null });
    },
    async requestsOf(subject) {
      return [...requests.values()]
        .filter((r) => sameSubject(r.subject, subject))
        .sort((a, b) => b.requestedAt.valueOf() - a.requestedAt.valueOf())
        .map((r) => structuredClone(r));
    },
  };
}
