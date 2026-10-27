import { randomUUID } from "node:crypto";

import { ident } from "@krizaka/db";

import {
  type AssessmentInput,
  type Incident,
  INCIDENT_CODE,
  INCIDENT_KIND,
  INCIDENT_STATUS,
  type IncidentActor,
  type IncidentDeps,
  IncidentError,
  type IncidentInput,
  type IncidentRegister,
  LEVEL,
  NOTICE_TARGET,
  retainUntil,
} from "./incident";
import { dbIncidentStore } from "./incident-persistence";
import type { Query } from "./port";

const bad = (message: string) => new IncidentError(INCIDENT_CODE.badInput, message);
const within = (value: string, max: number, what: string) => {
  if (value.trim().length < 1 || value.length > max) throw bad(`${what}: 1 to ${max} characters`);
};
const KINDS: readonly string[] = Object.values(INCIDENT_KIND);
const LEVELS: readonly string[] = Object.values(LEVEL);

function checkScope(scope: string) {
  within(scope, 100, "scope");
}

/**
 * The confidentiality incident register of a product (Loi 25, ss. 3.5 to 3.8). Every call is by scope (the tenant), and a closed
 * entry is never edited again; the database refuses to delete an entry before its retention ends.
 */
export function createIncidentRegister(deps: IncidentDeps): IncidentRegister {
  const schema = ident(deps.schema ?? "privacy");
  const storeFor = deps.storeFor ?? ((query: Query) => dbIncidentStore(query, schema));

  async function trace(query: Query, actor: IncidentActor, action: string, incident: Incident) {
    await deps.audit?.record(query, { actorId: actor.id, actorLabel: actor.label, action: `privacy.incident_${action}`, target: { type: "incident", id: incident.id }, detail: { scope: incident.scope, drill: incident.drill } });
  }

  /** Reads the incident under lock, applies `change` to a copy, saves it, traces it. */
  async function update(query: Query, scope: string, id: string, action: string, actor: IncidentActor, change: (incident: Incident) => void): Promise<Incident> {
    checkScope(scope);
    const store = storeFor(query);
    const incident = await store.get(scope, id, { lock: true });
    if (!incident) throw new IncidentError(INCIDENT_CODE.unknown, "no such incident in this register");
    if (incident.status === INCIDENT_STATUS.closed) throw new IncidentError(INCIDENT_CODE.closed, "a closed entry of the register is never edited");
    change(incident);
    await store.save(incident);
    await trace(query, actor, action, incident);
    return incident;
  }

  return {
    async open(query, input: IncidentInput, actor) {
      checkScope(input.scope);
      if (!KINDS.includes(input.kind)) throw bad(`kind « ${input.kind} » is not one of ${KINDS.join(", ")}`);
      within(input.description, 2000, "description");
      if (input.information.length < 1 || input.information.length > 30) throw bad("information: 1 to 30 categories");
      for (const category of input.information) within(category, 80, "information category");
      if (input.personsConcerned !== undefined && (!Number.isInteger(input.personsConcerned) || input.personsConcerned < 0)) throw bad("personsConcerned: a whole number, 0 or more");
      const now = deps.clock.now();
      const awareAt = input.awareAt ?? now;
      if (awareAt.valueOf() > now.valueOf()) throw bad("awareAt cannot be in the future");
      if (input.occurredAt && input.occurredAt.valueOf() > now.valueOf()) throw bad("occurredAt cannot be in the future");
      const incident: Incident = {
        id: randomUUID(),
        scope: input.scope,
        kind: input.kind,
        awareAt,
        occurredAt: input.occurredAt ?? null,
        description: input.description,
        information: [...input.information],
        personsConcerned: input.personsConcerned ?? null,
        measures: [],
        status: INCIDENT_STATUS.open,
        assessment: null,
        caiNotice: null,
        personsNotice: null,
        drill: input.drill ?? false,
        openedBy: actor.label,
        openedAt: now,
        closedAt: null,
        retainUntil: retainUntil(awareAt),
      };
      await storeFor(query).insert(incident);
      await trace(query, actor, "opened", incident);
      return incident;
    },
    assess(query, scope, id, input: AssessmentInput, actor) {
      for (const level of [input.sensitivity, input.consequences, input.likelihood]) if (!LEVELS.includes(level)) throw bad(`level « ${level} » is not one of ${LEVELS.join(", ")}`);
      within(input.rationale, 2000, "rationale");
      return update(query, scope, id, "assessed", actor, (incident) => {
        incident.assessment = { ...input, assessedAt: deps.clock.now(), assessedBy: actor.label };
        incident.status = INCIDENT_STATUS.assessed;
      });
    },
    recordMeasure(query, scope, id, text, actor) {
      within(text, 1000, "measure");
      return update(query, scope, id, "measure_recorded", actor, (incident) => {
        incident.measures.push({ at: deps.clock.now(), text });
      });
    },
    recordNotice(query, scope, id, target, notice, actor) {
      within(notice.channel, 40, "channel");
      return update(query, scope, id, `notice_${target}`, actor, (incident) => {
        if (!incident.assessment) throw new IncidentError(INCIDENT_CODE.notAssessed, "assess the risk before notifying");
        if (!incident.assessment.seriousInjury) throw new IncidentError(INCIDENT_CODE.noNoticeDue, "no notice is due: the assessment found no risk of serious injury");
        const sent = { sentAt: deps.clock.now(), channel: notice.channel, reference: notice.reference ?? null };
        if (target === NOTICE_TARGET.cai) incident.caiNotice = sent;
        else incident.personsNotice = sent;
      });
    },
    markDrill(query, scope, id, drill, actor) {
      return update(query, scope, id, "drill_marked", actor, (incident) => {
        incident.drill = drill;
      });
    },
    close(query, scope, id, actor) {
      return update(query, scope, id, "closed", actor, (incident) => {
        if (!incident.assessment) throw new IncidentError(INCIDENT_CODE.notAssessed, "assess the risk before closing");
        if (incident.assessment.seriousInjury && (!incident.caiNotice || !incident.personsNotice)) throw new IncidentError(INCIDENT_CODE.noticesMissing, "a risk of serious injury is closed once the Commission and the people concerned are notified");
        incident.status = INCIDENT_STATUS.closed;
        incident.closedAt = deps.clock.now();
      });
    },
    async get(query, scope, id) {
      checkScope(scope);
      return storeFor(query).get(scope, id);
    },
    async list(query, scope) {
      checkScope(scope);
      return storeFor(query).list(scope);
    },
    async exportRegister(query, scope) {
      checkScope(scope);
      return { format: 1, scope, generatedAt: deps.clock.now().toISOString(), entries: await storeFor(query).list(scope) };
    },
  };
}
