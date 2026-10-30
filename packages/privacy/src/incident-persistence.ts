import { ident, type Query } from "@krizaka/db";

import type {
  Incident,
  IncidentAssessment,
  IncidentKind,
  IncidentMeasure,
  IncidentNotice,
  IncidentStatus,
  IncidentStore,
  Level,
} from "./incident";

type Stamp = Date | string;
interface IncidentRow {
  id: string;
  scope: string;
  kind: IncidentKind;
  aware_at: Stamp;
  occurred_at: Stamp | null;
  description: string;
  information: string[];
  persons_concerned: number | null;
  measures: { at: string; text: string }[];
  status: IncidentStatus;
  assessment: {
    sensitivity: Level;
    consequences: Level;
    likelihood: Level;
    seriousInjury: boolean;
    rationale: string;
    assessedAt: string;
    assessedBy: string;
  } | null;
  cai_notice: { sentAt: string; channel: string; reference: string | null } | null;
  persons_notice: { sentAt: string; channel: string; reference: string | null } | null;
  drill: boolean;
  opened_by: string;
  opened_at: Stamp;
  closed_at: Stamp | null;
  retain_until: Stamp;
}

const COLUMNS =
  "id, scope, kind, aware_at, occurred_at, description, information, persons_concerned, measures, status, assessment, cai_notice, persons_notice, drill, opened_by, opened_at, closed_at, retain_until";
const optional = (stamp: Stamp | null) => (stamp === null ? null : new Date(stamp));
const toNotice = (n: IncidentRow["cai_notice"]): IncidentNotice | null =>
  n ? { sentAt: new Date(n.sentAt), channel: n.channel, reference: n.reference } : null;
const toAssessment = (a: IncidentRow["assessment"]): IncidentAssessment | null =>
  a ? { ...a, assessedAt: new Date(a.assessedAt) } : null;

const toIncident = (r: IncidentRow): Incident => ({
  id: r.id,
  scope: r.scope,
  kind: r.kind,
  awareAt: new Date(r.aware_at),
  occurredAt: optional(r.occurred_at),
  description: r.description,
  information: r.information,
  personsConcerned: r.persons_concerned,
  measures: r.measures.map((m): IncidentMeasure => ({ at: new Date(m.at), text: m.text })),
  status: r.status,
  assessment: toAssessment(r.assessment),
  caiNotice: toNotice(r.cai_notice),
  personsNotice: toNotice(r.persons_notice),
  drill: r.drill,
  openedBy: r.opened_by,
  openedAt: new Date(r.opened_at),
  closedAt: optional(r.closed_at),
  retainUntil: new Date(r.retain_until),
});

const json = (value: unknown) => (value === null ? null : JSON.stringify(value));

/** The PostgreSQL incident store, over the `Query` it is given (the caller's transaction). `schema`: default `privacy`. */
export function dbIncidentStore(query: Query, schema = "privacy"): IncidentStore {
  const table = `${ident(schema)}.incident`;
  const values = (i: Incident) => [
    i.id,
    i.scope,
    i.kind,
    i.awareAt,
    i.occurredAt,
    i.description,
    i.information,
    i.personsConcerned,
    JSON.stringify(i.measures),
    i.status,
    json(i.assessment),
    json(i.caiNotice),
    json(i.personsNotice),
    i.drill,
    i.openedBy,
    i.openedAt,
    i.closedAt,
    i.retainUntil,
  ];
  return {
    async insert(i) {
      await query(
        `INSERT INTO ${table} (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18)`,
        values(i),
      );
    },
    async save(i) {
      await query(
        `UPDATE ${table} SET kind = $3, aware_at = $4, occurred_at = $5, description = $6, information = $7, persons_concerned = $8, measures = $9::jsonb, status = $10, assessment = $11::jsonb, cai_notice = $12::jsonb, persons_notice = $13::jsonb, drill = $14, opened_by = $15, opened_at = $16, closed_at = $17, retain_until = $18 WHERE scope = $2 AND id = $1`,
        values(i),
      );
    },
    async get(scope, id, options) {
      const [row] = await query<IncidentRow>(
        `SELECT ${COLUMNS} FROM ${table} WHERE scope = $1 AND id = $2${options?.lock ? " FOR UPDATE" : ""}`,
        [scope, id],
      );
      return row ? toIncident(row) : null;
    },
    async list(scope) {
      return (
        await query<IncidentRow>(`SELECT ${COLUMNS} FROM ${table} WHERE scope = $1 ORDER BY aware_at, id`, [scope])
      ).map(toIncident);
    },
  };
}
