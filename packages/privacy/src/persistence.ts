import { ident, type Query } from "@krizaka/db";

import type { ConsentRecord, PrivacyRequest, PrivacyStore, RequestKind, RequestStatus, Subject } from "./port";

interface ConsentRow {
  id: string;
  subject_kind: string;
  subject_id: string;
  purpose: string;
  version: string;
  granted: boolean;
  means: string | null;
  at: Date | string;
}
interface RequestRow {
  id: string;
  subject_kind: string;
  subject_id: string;
  kind: RequestKind;
  status: RequestStatus;
  requested_at: Date | string;
  completed_at: Date | string | null;
  failure: string | null;
}

const toConsent = (r: ConsentRow): ConsentRecord => ({
  id: r.id,
  subject: { kind: r.subject_kind, id: r.subject_id },
  purpose: r.purpose,
  version: r.version,
  granted: r.granted,
  means: r.means,
  at: new Date(r.at),
});
const toRequest = (r: RequestRow): PrivacyRequest => ({
  id: r.id,
  subject: { kind: r.subject_kind, id: r.subject_id },
  kind: r.kind,
  status: r.status,
  requestedAt: new Date(r.requested_at),
  completedAt: r.completed_at === null ? null : new Date(r.completed_at),
  failure: r.failure,
});

const CONSENT_COLUMNS = "id, subject_kind, subject_id, purpose, version, granted, means, at";
const REQUEST_COLUMNS = "id, subject_kind, subject_id, kind, status, requested_at, completed_at, failure";

/**
 * The PostgreSQL store of « privacy », over the `Query` it is given (the caller's transaction, to join its unit of work).
 * @param schema the Postgres schema of the module, default `privacy`
 */
export function dbPrivacyStore(query: Query, schema = "privacy"): PrivacyStore {
  const consent = `${ident(schema)}.consent`;
  const request = `${ident(schema)}.request`;
  const same = (subject: Subject) => [subject.kind, subject.id];
  return {
    async insertConsent(c) {
      await query(
        `INSERT INTO ${consent} (id, subject_kind, subject_id, purpose, version, granted, means, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [c.id, c.subject.kind, c.subject.id, c.purpose, c.version, c.granted, c.means, c.at],
      );
    },
    async latestConsent(subject, purpose) {
      const [row] = await query<ConsentRow>(
        `SELECT ${CONSENT_COLUMNS} FROM ${consent} WHERE subject_kind = $1 AND subject_id = $2 AND purpose = $3 ORDER BY seq DESC LIMIT 1`,
        [...same(subject), purpose],
      );
      return row ? toConsent(row) : null;
    },
    async consentHistory(subject) {
      return (
        await query<ConsentRow>(
          `SELECT ${CONSENT_COLUMNS} FROM ${consent} WHERE subject_kind = $1 AND subject_id = $2 ORDER BY seq`,
          same(subject),
        )
      ).map(toConsent);
    },
    async insertRequest(r) {
      await query(
        `INSERT INTO ${request} (id, subject_kind, subject_id, kind, status, requested_at, completed_at, failure) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [r.id, r.subject.kind, r.subject.id, r.kind, r.status, r.requestedAt, r.completedAt, r.failure],
      );
    },
    async getRequest(id) {
      const [row] = await query<RequestRow>(`SELECT ${REQUEST_COLUMNS} FROM ${request} WHERE id = $1`, [id]);
      return row ? toRequest(row) : null;
    },
    async finishRequest(id, outcome) {
      await query(`UPDATE ${request} SET status = $2, completed_at = $3, failure = $4 WHERE id = $1`, [
        id,
        outcome.status,
        outcome.at,
        outcome.failure ?? null,
      ]);
    },
    async requestsOf(subject) {
      return (
        await query<RequestRow>(
          `SELECT ${REQUEST_COLUMNS} FROM ${request} WHERE subject_kind = $1 AND subject_id = $2 ORDER BY requested_at DESC, id`,
          same(subject),
        )
      ).map(toRequest);
    },
  };
}
