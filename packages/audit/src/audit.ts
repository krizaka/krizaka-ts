import { ident } from "@krizaka/db";
import { subDays } from "date-fns";

import { dbAuditStore } from "./persistence";
import type { AuditEntry, AuditEntryInput, AuditFilters, AuditStore, Clock, Query } from "./port";
import { checkFilters, checkRetention, toInsert } from "./rules";

export interface AuditDeps {
  clock: Clock;
  /** The store over a query (a pool or a transaction). Default: the PostgreSQL store on schema `audit`. */
  storeFor?: (query: Query) => AuditStore;
  /** The Postgres schema, when the product renamed the module's (used by the default store). */
  schema?: string;
  /** The product's fixed list of actions, when it keeps one (refused otherwise). */
  allowedActions?: readonly string[];
  /** Where a quiet write's failure goes (the product's logger). */
  onError?: (error: unknown, entry: AuditEntryInput) => void | Promise<void>;
}

/** The trail as a product uses it. Every function takes the `Query` it writes through: pass `tx` to join a unit of work. */
export interface Audit {
  /** Records an entry; throws on failure, so it can join the caller's transaction (it commits or rolls back with it). */
  record(query: Query, entry: AuditEntryInput): Promise<void>;
  /** Records an entry beside the work: a failure goes to `onError`, never to the caller. */
  recordQuietly(query: Query, entry: AuditEntryInput): Promise<void>;
  list(query: Query, filters: AuditFilters): Promise<AuditEntry[]>;
  /** One actor's entries, for the Loi 25 export. */
  exportFor(query: Query, actorId: string): Promise<AuditEntry[]>;
  /** Detaches one actor from the trail (Loi 25 erasure): the facts stay, the person does not. */
  redactActor(query: Query, actorId: string): Promise<number>;
  /** Removes what is older than `retentionDays` (the `audit.retentionDays` setting). */
  purge(query: Query, options: { retentionDays: number }): Promise<number>;
}

/** Hands a quiet write's failure to the sink; a sink that throws or rejects is swallowed too: `recordQuietly` never throws. */
async function report(onError: AuditDeps["onError"], error: unknown, entry: AuditEntryInput): Promise<void> {
  try {
    await onError?.(error, entry);
  } catch {
    // The sink is the product's logger; a failing logger must not fail the request it was only meant to observe.
  }
}

/**
 * The audit trail of a product.
 * @param deps the clock, the store, the product's action list and error sink
 * @returns the trail's functions
 */
export function createAudit(deps: AuditDeps): Audit {
  const schema = ident(deps.schema ?? "audit");
  const storeFor = deps.storeFor ?? ((query: Query) => dbAuditStore(query, schema));
  const record = async (query: Query, entry: AuditEntryInput) => storeFor(query).insert(toInsert(entry, deps.clock.now(), deps.allowedActions));
  return {
    record,
    async recordQuietly(query, entry) {
      try {
        await record(query, entry);
      } catch (error) {
        await report(deps.onError, error, entry);
      }
    },
    async list(query, filters) {
      checkFilters(filters);
      return storeFor(query).list(filters);
    },
    exportFor: (query, actorId) => storeFor(query).forActor(actorId),
    redactActor: (query, actorId) => storeFor(query).redactActor(actorId),
    async purge(query, { retentionDays }) {
      checkRetention(retentionDays);
      return storeFor(query).purgeBefore(subDays(deps.clock.now(), retentionDays));
    },
  };
}
