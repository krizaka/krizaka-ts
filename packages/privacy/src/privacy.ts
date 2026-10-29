import { randomUUID } from "node:crypto";

import { ident } from "@krizaka/db";
import { subHours } from "@krizaka/time";

import { dbPrivacyStore } from "./persistence";
import {
  type AuditPort,
  type Clock,
  type ConsentInput,
  type ConsentRecord,
  type ExportDocument,
  type OutboxPort,
  PRIVACY_CODE,
  type PrivacyContributor,
  PrivacyError,
  type PrivacyRequest,
  type PrivacyStore,
  type Query,
  REQUEST_KIND,
  REQUEST_STATUS,
  type Subject,
} from "./port";
import { checkPurpose, checkSubject } from "./rules";

/** The product's unit of work: runs `work` on one connection, commits when it resolves, rolls back when it throws (`transaction` of `@krizaka/db`). */
export type Transaction = <T>(work: (tx: Query) => Promise<T>) => Promise<T>;

export interface PrivacyDeps {
  clock: Clock;
  /** Every module that holds personal data, and the product's own. Their names are the keys of the export. */
  contributors: readonly PrivacyContributor[];
  /** The purposes the product declares (`screening`, `marketing`). A consent for another is refused. */
  purposes: readonly string[];
  /** The product's transaction, for the erasure. */
  transaction: Transaction;
  /** How many days a purpose is kept: the settings `privacy.retention.<purpose>Days` (`retentionFromSettings`). `undefined` = no retention for it. */
  retentionDays?: (purpose: string) => number | undefined | Promise<number | undefined>;
  /** The audit trail: an erasure is recorded there without personal data. */
  audit?: AuditPort;
  /** The outbox: required for the asynchronous export of a large account (`requestExport`). */
  outbox?: OutboxPort;
  /** The store over a query. Default: the PostgreSQL store on schema `privacy`. */
  storeFor?: (query: Query) => PrivacyStore;
  /** The Postgres schema, when the product renamed the module's (used by the default store). */
  schema?: string;
}

export interface Privacy {
  /** Writes a consent or a withdrawal. Never edits one. */
  recordConsent(query: Query, input: ConsentInput): Promise<ConsentRecord>;
  /** Whether the consent with the last word for this purpose is a yes. A person who never said anything has not consented. */
  hasConsent(query: Query, subject: Subject, purpose: string): Promise<boolean>;
  /** Every consent and withdrawal of the subject, oldest first. */
  consentHistory(query: Query, subject: Subject): Promise<ConsentRecord[]>;
  /** The export, at once: one document with a part per contributor. The request is recorded. */
  exportSubject(query: Query, subject: Subject): Promise<ExportDocument>;
  /**
   * The export of a large account, asynchronously: records the request and appends a message to the outbox IN THE CALLER'S
   * TRANSACTION (`tx`). A worker then calls `fulfilExport(requestId, deliver)`. The message holds the request id only.
   */
  requestExport(tx: Query, subject: Subject): Promise<{ requestId: string }>;
  /** Assembles the export of a recorded request and hands it to `deliver` (store the file, mail a link); the request is completed after `deliver` returns. */
  fulfilExport(
    query: Query,
    requestId: string,
    deliver: (document: ExportDocument, request: PrivacyRequest) => Promise<void>,
  ): Promise<void>;
  /**
   * Erases the subject from every contributor in ONE transaction, withdraws their live consents, and records the request and an
   * audit entry that names no one. If a contributor fails nothing is erased, the request is recorded as failed, and the error is thrown.
   */
  eraseSubject(subject: Subject, options?: { noticeVersion?: string }): Promise<PrivacyRequest>;
  /** Removes, for each purpose with a retention, what the contributors hold past it. Returns how many rows each purpose removed. */
  purge(query: Query): Promise<Record<string, number>>;
  /** The subject's requests, newest first. */
  requests(query: Query, subject: Subject): Promise<PrivacyRequest[]>;
}

const FAILURE_CODE = "CONTRIBUTOR_FAILED";
const ERASURE_VERSION = "erasure";

/**
 * Privacy for a product (Loi 25).
 * @param deps the contributors, the purposes, the product's transaction and the clock
 * @throws PrivacyError for a purpose or a contributor name that is not well formed or appears twice
 */
export function createPrivacy(deps: PrivacyDeps): Privacy {
  const schema = ident(deps.schema ?? "privacy");
  const storeFor = deps.storeFor ?? ((query: Query) => dbPrivacyStore(query, schema));
  for (const purpose of deps.purposes) checkPurpose(purpose);
  const names = deps.contributors.map((c) => c.name);
  if (new Set(names).size !== names.length)
    throw new PrivacyError(PRIVACY_CODE.contributorFailed, `two contributors have the same name: ${names.join(", ")}`);
  const known = new Set(deps.purposes);

  async function assemble(query: Query, subject: Subject): Promise<ExportDocument> {
    const modules: Record<string, unknown> = {};
    for (const contributor of deps.contributors) {
      try {
        modules[contributor.name] = await contributor.exportFor(query, subject);
      } catch (cause) {
        throw new PrivacyError(PRIVACY_CODE.contributorFailed, `the export of « ${contributor.name} » failed`, {
          cause,
        });
      }
    }
    return { format: 1, subject, generatedAt: deps.clock.now().toISOString(), modules };
  }

  const newRequest = (subject: Subject, kind: PrivacyRequest["kind"]): PrivacyRequest => ({
    id: randomUUID(),
    subject,
    kind,
    status: REQUEST_STATUS.requested,
    requestedAt: deps.clock.now(),
    completedAt: null,
    failure: null,
  });

  async function recordConsent(query: Query, input: ConsentInput): Promise<ConsentRecord> {
    checkSubject(input.subject);
    checkPurpose(input.purpose);
    if (!known.has(input.purpose))
      throw new PrivacyError(PRIVACY_CODE.badPurpose, `purpose « ${input.purpose} » is not one the product declared`);
    if (input.version.length < 1 || input.version.length > 100)
      throw new PrivacyError(PRIVACY_CODE.badConsent, "the notice version is 1 to 100 characters");
    const record: ConsentRecord = {
      id: randomUUID(),
      subject: input.subject,
      purpose: input.purpose,
      version: input.version,
      granted: input.granted,
      means: input.means ?? null,
      at: deps.clock.now(),
    };
    await storeFor(query).insertConsent(record);
    return record;
  }

  return {
    recordConsent,
    async hasConsent(query, subject, purpose) {
      checkSubject(subject);
      checkPurpose(purpose);
      return (await storeFor(query).latestConsent(subject, purpose))?.granted === true;
    },
    async consentHistory(query, subject) {
      checkSubject(subject);
      return storeFor(query).consentHistory(subject);
    },
    async exportSubject(query, subject) {
      checkSubject(subject);
      const store = storeFor(query);
      const request = newRequest(subject, REQUEST_KIND.export);
      await store.insertRequest(request);
      try {
        const document = await assemble(query, subject);
        await store.finishRequest(request.id, { status: REQUEST_STATUS.completed, at: deps.clock.now() });
        return document;
      } catch (error) {
        await store.finishRequest(request.id, {
          status: REQUEST_STATUS.failed,
          at: deps.clock.now(),
          failure: FAILURE_CODE,
        });
        throw error;
      }
    },
    async requestExport(tx, subject) {
      checkSubject(subject);
      if (!deps.outbox) throw new PrivacyError(PRIVACY_CODE.noOutbox, "an asynchronous export needs the outbox");
      const request = newRequest(subject, REQUEST_KIND.export);
      await storeFor(tx).insertRequest(request);
      await deps.outbox.append(tx, {
        topic: "privacy",
        type: "evt.privacy.export_requested.v1",
        payload: { requestId: request.id },
        id: request.id,
      });
      return { requestId: request.id };
    },
    async fulfilExport(query, requestId, deliver) {
      const store = storeFor(query);
      const request = await store.getRequest(requestId);
      if (!request) throw new PrivacyError(PRIVACY_CODE.unknownRequest, `no request ${requestId}`);
      if (request.kind !== REQUEST_KIND.export)
        throw new PrivacyError(PRIVACY_CODE.notAnExport, `request ${requestId} is not an export`);
      if (request.status === REQUEST_STATUS.completed)
        throw new PrivacyError(PRIVACY_CODE.alreadyDone, `request ${requestId} is already completed`);
      try {
        await deliver(await assemble(query, request.subject), request);
      } catch (error) {
        await store.finishRequest(requestId, {
          status: REQUEST_STATUS.failed,
          at: deps.clock.now(),
          failure: FAILURE_CODE,
        });
        throw error;
      }
      await store.finishRequest(requestId, { status: REQUEST_STATUS.completed, at: deps.clock.now() });
    },
    async eraseSubject(subject, options = {}) {
      checkSubject(subject);
      const request = newRequest(subject, REQUEST_KIND.erasure);
      try {
        return await deps.transaction(async (tx) => {
          const store = storeFor(tx);
          await store.insertRequest(request);
          for (const contributor of deps.contributors) {
            try {
              await contributor.eraseFor(tx, subject);
            } catch (cause) {
              throw new PrivacyError(PRIVACY_CODE.contributorFailed, `the erasure of « ${contributor.name} » failed`, {
                cause,
              });
            }
          }
          for (const purpose of deps.purposes) {
            if ((await store.latestConsent(subject, purpose))?.granted)
              await recordConsent(tx, {
                subject,
                purpose,
                version: options.noticeVersion ?? ERASURE_VERSION,
                granted: false,
                means: ERASURE_VERSION,
              });
          }
          const completedAt = deps.clock.now();
          await store.finishRequest(request.id, { status: REQUEST_STATUS.completed, at: completedAt });
          // the entry names the request and the modules, never the person
          await deps.audit?.record(tx, {
            actorId: null,
            actorLabel: "privacy",
            action: "privacy.erasure_completed",
            target: { type: "privacy_request", id: request.id },
            detail: { contributors: names },
          });
          return { ...request, status: REQUEST_STATUS.completed, completedAt };
        });
      } catch (error) {
        // the transaction rolled back, request row included: record the failure beside it, and never mask the original error
        try {
          await deps.transaction((tx) =>
            storeFor(tx).insertRequest({
              ...request,
              status: REQUEST_STATUS.failed,
              completedAt: deps.clock.now(),
              failure: FAILURE_CODE,
            }),
          );
        } catch (recordFailure) {
          throw new AggregateError([error, recordFailure], "the erasure failed, and so did recording its failure", {
            cause: recordFailure,
          });
        }
        throw error;
      }
    },
    async purge(query) {
      const removed: Record<string, number> = {};
      for (const purpose of deps.purposes) {
        const days = await deps.retentionDays?.(purpose);
        if (days === undefined) continue;
        if (!Number.isInteger(days) || days < 1)
          throw new RangeError(`the retention of « ${purpose} » must be a whole number of days from 1, got ${days}`);
        const before = subHours(deps.clock.now(), days * 24);
        let total = 0;
        for (const contributor of deps.contributors)
          total += (await contributor.purgeExpired?.(query, { purpose, before })) ?? 0;
        removed[purpose] = total;
      }
      return removed;
    },
    async requests(query, subject) {
      checkSubject(subject);
      return storeFor(query).requestsOf(subject);
    },
  };
}
