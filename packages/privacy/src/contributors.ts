import type { Query } from "@krizaka/db";

import type { PrivacyContributor } from "./port";

/** The structural slice of `@krizaka/audit` that contributes: what the trail holds about an actor, and detaching them from it. */
export interface AuditTrail {
  exportFor(query: Query, actorId: string): Promise<unknown>;
  redactActor(query: Query, actorId: string): Promise<number>;
}

/**
 * `@krizaka/audit` as a contributor: an export lists the actor's entries; an erasure detaches the person (id and address removed, the
 * label « erased ») and keeps the facts. It applies to a subject of the kind the product's actors are (default `account`).
 * @param audit the product's audit (`createAudit(...)`)
 */
export function auditContributor(audit: AuditTrail, options: { kind?: string } = {}): PrivacyContributor {
  const kind = options.kind ?? "account";
  return {
    name: "audit",
    async exportFor(query, subject) {
      return subject.kind === kind ? audit.exportFor(query, subject.id) : [];
    },
    async eraseFor(tx, subject) {
      if (subject.kind === kind) await audit.redactActor(tx, subject.id);
    },
  };
}
