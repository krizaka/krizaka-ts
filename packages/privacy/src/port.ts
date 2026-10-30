/**
 * The ports of « privacy » (Loi 25): consents by purpose, the person's data exported from every module that holds it, and erased
 * from every module in one transaction. Generic: no product import, no database client (a `Query` comes in), no wall clock (a
 * `Clock` comes in). What a module holds, and what erasing it means (blanking a row, deleting a file, keeping an invoice for six
 * years), is the module's: it implements `PrivacyContributor`.
 */
export type { Clock, Query } from "@krizaka/db";
import type { Query } from "@krizaka/db";

/**
 * Whose data it is. Usually an account (`{ kind: "account", id }`), but a product's data subject is not always an account: Akinaza's
 * is a client file, Yomizaka's a tenant on an application. The `kind` says which.
 */
export interface Subject {
  /** What the id identifies: `account`, `client`, `application`. Lower-case letters, digits and `_`. */
  kind: string;
  /** The product's id for it (a UUID, a slug). */
  id: string;
}

/** What a product records when a person agrees, or withdraws. */
export interface ConsentInput {
  subject: Subject;
  /** What the person agreed to (`marketing`, `screening`, `reminders`): one of the product's declared purposes. */
  purpose: string;
  /** The version of the notice shown to them: the proof of WHAT they agreed to. */
  version: string;
  granted: boolean;
  /** How they said it (`checkbox`, `link`, `verbal`, `erasure`). */
  means?: string | undefined;
}

/** A consent as written. It is never edited: a withdrawal is a new row. */
export interface ConsentRecord {
  id: string;
  subject: Subject;
  purpose: string;
  version: string;
  granted: boolean;
  means: string | null;
  at: Date;
}

export const REQUEST_KIND = { export: "export", erasure: "erasure" } as const;
export type RequestKind = (typeof REQUEST_KIND)[keyof typeof REQUEST_KIND];
export const REQUEST_STATUS = { requested: "requested", completed: "completed", failed: "failed" } as const;
export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

/** An export or an erasure asked for, and where it stands. It holds an id of the subject and no other personal data. */
export interface PrivacyRequest {
  id: string;
  subject: Subject;
  kind: RequestKind;
  status: RequestStatus;
  requestedAt: Date;
  completedAt: Date | null;
  /** A code, never a message that could carry data. */
  failure: string | null;
}

/**
 * A module that holds personal data. The product registers one per module and one for its own tables.
 *
 * - `exportFor` returns what the module holds about the subject, as JSON-able data.
 * - `eraseFor` erases or anonymises it, through the transaction it is given, so the whole erasure commits or rolls back together.
 *   A side effect outside the database (a file in storage) is not done here: append it to the outbox in the same transaction.
 * - `purgeExpired` (optional) removes what the retention of a purpose says is past, for everyone.
 */
export interface PrivacyContributor {
  /** A stable name, the key of its part in the export (`audit`, `orders`). */
  name: string;
  exportFor(query: Query, subject: Subject): Promise<unknown>;
  eraseFor(tx: Query, subject: Subject): Promise<void>;
  purgeExpired?(tx: Query, input: { purpose: string; before: Date }): Promise<number>;
}

/** The whole export of a subject: one document, a part per contributor. */
export interface ExportDocument {
  format: 1;
  subject: Subject;
  generatedAt: string;
  modules: Record<string, unknown>;
}

/** Where consents and requests live. Every adapter runs `privacyStoreContract` (`@krizaka/privacy/testkit`). */
export interface PrivacyStore {
  insertConsent(consent: ConsentRecord): Promise<void>;
  /** The consent with the last word for this purpose, or null when the person never said anything. */
  latestConsent(subject: Subject, purpose: string): Promise<ConsentRecord | null>;
  /** Every consent of the subject, oldest first. */
  consentHistory(subject: Subject): Promise<ConsentRecord[]>;
  insertRequest(request: PrivacyRequest): Promise<void>;
  getRequest(id: string): Promise<PrivacyRequest | null>;
  finishRequest(id: string, outcome: { status: "completed" | "failed"; at: Date; failure?: string }): Promise<void>;
  requestsOf(subject: Subject): Promise<PrivacyRequest[]>;
}

/** The structural slice of `@krizaka/audit` this package writes through, so it adds no dependency. */
export interface AuditPort {
  record(
    query: Query,
    entry: {
      actorId: string | null;
      actorLabel: string;
      action: string;
      target?: { type: string; id: string } | null;
      detail?: Record<string, unknown>;
    },
  ): Promise<unknown>;
}

/** The structural slice of `@krizaka/outbox` used for a large export. */
export interface OutboxPort {
  append(tx: Query, message: { topic: string; type: string; payload: unknown; id?: string }): Promise<unknown>;
}

export const PRIVACY_CODE = {
  badSubject: "PRIVACY_BAD_SUBJECT",
  badPurpose: "PRIVACY_BAD_PURPOSE",
  badConsent: "PRIVACY_BAD_CONSENT",
  unknownRequest: "PRIVACY_UNKNOWN_REQUEST",
  notAnExport: "PRIVACY_NOT_AN_EXPORT",
  alreadyDone: "PRIVACY_ALREADY_DONE",
  contributorFailed: "PRIVACY_CONTRIBUTOR_FAILED",
  noOutbox: "PRIVACY_NO_OUTBOX",
} as const;
export type PrivacyCode = (typeof PRIVACY_CODE)[keyof typeof PRIVACY_CODE];

export class PrivacyError extends Error {
  constructor(
    readonly code: PrivacyCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PrivacyError";
  }
}
