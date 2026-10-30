import { type Incident, INCIDENT_STATUS, type IncidentStore } from "./incident";

/** An in-memory incident store, for unit tests and demos (the contract kit runs on it and on the database's). */
export function memoryIncidentStore(): IncidentStore {
  const rows = new Map<string, Incident>();
  const key = (scope: string, id: string) => `${scope}\u0000${id}`;
  return {
    async insert(incident) {
      rows.set(key(incident.scope, incident.id), structuredClone(incident));
    },
    async save(incident) {
      const k = key(incident.scope, incident.id);
      const current = rows.get(k);
      if (!current) return; // like an UPDATE that matches nothing
      if (current.status === INCIDENT_STATUS.closed) throw new Error("a closed incident is never edited");
      rows.set(k, structuredClone(incident));
    },
    async get(scope, id) {
      const found = rows.get(key(scope, id));
      return found ? structuredClone(found) : null;
    },
    async list(scope) {
      return [...rows.values()]
        .filter((i) => i.scope === scope)
        .sort((a, b) => a.awareAt.valueOf() - b.awareAt.valueOf() || a.id.localeCompare(b.id))
        .map((i) => structuredClone(i));
    },
  };
}
