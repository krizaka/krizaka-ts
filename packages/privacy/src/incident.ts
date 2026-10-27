import type { AuditPort, Clock, Query } from "./port";

/**
 * The confidentiality incident register (Loi 25). Act respecting the protection of personal information in the private sector
 * (CQLR c. P-39.1), ss. 3.5 to 3.8, and the Regulation respecting confidentiality incidents (CQLR c. P-39.1, r. 3.1): see the README
 * for the links. The register holds the facts of an incident and NO personal data of the people concerned (only how many, and which
 * categories of information).
 */

/** What happened to the information (the Act speaks of unauthorised access, use, communication and loss). */
export const INCIDENT_KIND = { access: "access", use: "use", communication: "communication", loss: "loss" } as const;
export type IncidentKind = (typeof INCIDENT_KIND)[keyof typeof INCIDENT_KIND];

export const INCIDENT_STATUS = { open: "open", assessed: "assessed", closed: "closed" } as const;
export type IncidentStatus = (typeof INCIDENT_STATUS)[keyof typeof INCIDENT_STATUS];

export const LEVEL = { low: "low", medium: "medium", high: "high" } as const;
export type Level = (typeof LEVEL)[keyof typeof LEVEL];

export const NOTICE_TARGET = { cai: "cai", persons: "persons" } as const;
export type NoticeTarget = (typeof NOTICE_TARGET)[keyof typeof NOTICE_TARGET];

/** The three factors of the risk assessment (s. 3.6) and the decision of the person in charge. */
export interface IncidentAssessment {
  /** How sensitive the information is. */
  sensitivity: Level;
  /** How serious the anticipated consequences of its use are. */
  consequences: Level;
  /** How likely it is to be misused. */
  likelihood: Level;
  /** The decision: a risk of serious injury means notifying the Commission d'accès à l'information and the people concerned. */
  seriousInjury: boolean;
  rationale: string;
  assessedAt: Date;
  assessedBy: string;
}

/** A notice sent, to the Commission or to the people concerned. */
export interface IncidentNotice {
  sentAt: Date;
  /** How it was sent (`form`, `email`, `letter`, `public`). */
  channel: string;
  /** The Commission's acknowledgement, if any. */
  reference: string | null;
}

export interface IncidentMeasure {
  at: Date;
  text: string;
}

/** One register entry: an incident, from the day the enterprise became aware of it. */
export interface Incident {
  id: string;
  /** Whose register it is: a tenant, an organisation. Entries of another scope are never read. */
  scope: string;
  kind: IncidentKind;
  /** When the enterprise became aware of it: the start of the retention. */
  awareAt: Date;
  occurredAt: Date | null;
  description: string;
  /** The categories of information concerned (`lease`, `pay stub`), never the information. */
  information: string[];
  /** How many people are concerned, null while unknown. */
  personsConcerned: number | null;
  measures: IncidentMeasure[];
  status: IncidentStatus;
  assessment: IncidentAssessment | null;
  caiNotice: IncidentNotice | null;
  personsNotice: IncidentNotice | null;
  /** A fictitious incident, run to prove the procedure. It stays in the register, marked. */
  drill: boolean;
  openedBy: string;
  openedAt: Date;
  closedAt: Date | null;
  /** The register entry cannot be deleted before this date: five years after `awareAt`. */
  retainUntil: Date;
}

export interface IncidentInput {
  scope: string;
  kind: IncidentKind;
  awareAt?: Date | undefined;
  occurredAt?: Date | undefined;
  description: string;
  information: readonly string[];
  personsConcerned?: number | undefined;
  drill?: boolean | undefined;
}

export interface AssessmentInput {
  sensitivity: Level;
  consequences: Level;
  likelihood: Level;
  seriousInjury: boolean;
  rationale: string;
}

/** Where the register lives. Every adapter runs `incidentStoreContract` (`@krizaka/privacy/testkit`). Every read is by scope. */
export interface IncidentStore {
  insert(incident: Incident): Promise<void>;
  /** Replaces an incident that is not closed. */
  save(incident: Incident): Promise<void>;
  /** `lock`: for the read-then-write of one incident (`FOR UPDATE`). */
  get(scope: string, id: string, options?: { lock?: boolean }): Promise<Incident | null>;
  /** The whole register of the scope, oldest awareness first. */
  list(scope: string): Promise<Incident[]>;
}

export interface IncidentActor {
  /** An opaque id (an admin account). */
  id: string | null;
  label: string;
}

export interface IncidentDeps {
  clock: Clock;
  audit?: AuditPort;
  storeFor?: (query: Query) => IncidentStore;
  /** The Postgres schema, when the product renamed the module's. */
  schema?: string;
}

/** The register as handed to the Commission on request: one document, the entries oldest first. */
export interface RegisterDocument {
  format: 1;
  scope: string;
  generatedAt: string;
  entries: Incident[];
}

export interface IncidentRegister {
  /** Opens an incident (s. 3.5: as soon as there is reason to believe one occurred). */
  open(query: Query, input: IncidentInput, actor: IncidentActor): Promise<Incident>;
  /** Writes the risk assessment (s. 3.6); it can be redone until the incident is closed. */
  assess(query: Query, scope: string, id: string, input: AssessmentInput, actor: IncidentActor): Promise<Incident>;
  /** Records a measure taken to reduce the risk and prevent a new incident (s. 3.5). */
  recordMeasure(query: Query, scope: string, id: string, text: string, actor: IncidentActor): Promise<Incident>;
  /** Records a notice sent. Only an incident assessed as a risk of serious injury is notified. */
  recordNotice(query: Query, scope: string, id: string, target: NoticeTarget, notice: { channel: string; reference?: string | undefined }, actor: IncidentActor): Promise<Incident>;
  /** Marks the incident as a drill (or not). */
  markDrill(query: Query, scope: string, id: string, drill: boolean, actor: IncidentActor): Promise<Incident>;
  /** Closes it: assessed, and both notices sent when the risk is serious. A closed entry is never edited again. */
  close(query: Query, scope: string, id: string, actor: IncidentActor): Promise<Incident>;
  get(query: Query, scope: string, id: string): Promise<Incident | null>;
  /** The register of the scope. */
  list(query: Query, scope: string): Promise<Incident[]>;
  exportRegister(query: Query, scope: string): Promise<RegisterDocument>;
}

export const INCIDENT_CODE = {
  badInput: "INCIDENT_BAD_INPUT",
  unknown: "INCIDENT_UNKNOWN",
  closed: "INCIDENT_CLOSED",
  notAssessed: "INCIDENT_NOT_ASSESSED",
  noNoticeDue: "INCIDENT_NO_NOTICE_DUE",
  noticesMissing: "INCIDENT_NOTICES_MISSING",
} as const;
export type IncidentCode = (typeof INCIDENT_CODE)[keyof typeof INCIDENT_CODE];

export class IncidentError extends Error {
  constructor(
    readonly code: IncidentCode,
    message: string,
  ) {
    super(message);
    this.name = "IncidentError";
  }
}

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

/**
 * A guide for the person in charge, never the decision: the injury is serious when the information is sensitive and misuse is not
 * unlikely, when the consequences are severe and misuse is likely, or when everything is at least medium and misuse is likely.
 */
export function suggestSeriousInjury(factors: Pick<AssessmentInput, "sensitivity" | "consequences" | "likelihood">): boolean {
  const { sensitivity, consequences, likelihood } = { sensitivity: RANK[factors.sensitivity], consequences: RANK[factors.consequences], likelihood: RANK[factors.likelihood] };
  if (sensitivity === RANK.high && likelihood >= RANK.medium) return true;
  if (consequences === RANK.high && likelihood === RANK.high) return true;
  return sensitivity >= RANK.medium && consequences >= RANK.medium && likelihood === RANK.high;
}

/** Five years after the enterprise became aware of the incident (the Regulation's minimum for keeping the register). */
export function retainUntil(awareAt: Date): Date {
  const until = new Date(awareAt);
  until.setUTCFullYear(until.getUTCFullYear() + 5);
  return until;
}

const FORMULA = /^[=+\-@\t\r]/;
const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  const safe = FORMULA.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
export const REGISTER_CSV_COLUMNS = ["id", "kind", "aware_at", "occurred_at", "description", "information", "persons_concerned", "serious_injury", "assessed_at", "cai_notice_at", "persons_notice_at", "measures", "status", "drill", "closed_at", "retain_until"] as const;

/** The register as CSV (RFC 4180), cells that a spreadsheet would read as a formula are quoted with a leading apostrophe. */
export function registerToCsv(entries: readonly Incident[]): string {
  const rows = entries.map((e) =>
    [e.id, e.kind, e.awareAt, e.occurredAt, e.description, e.information.join("; "), e.personsConcerned, e.assessment?.seriousInjury ?? "", e.assessment?.assessedAt ?? "", e.caiNotice?.sentAt ?? "", e.personsNotice?.sentAt ?? "", e.measures.map((m) => m.text).join("; "), e.status, e.drill, e.closedAt, e.retainUntil].map(cell).join(","),
  );
  return [REGISTER_CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
