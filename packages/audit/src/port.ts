/**
 * The ports of « audit »: who did what, when, to what. Generic: no product import, no database client (a `Query` comes in),
 * no wall clock (a `Clock` comes in). What an action means is the product's; the package keeps the trail.
 */
export type { Clock, Query } from "@krizaka/db";

/** What a product records. `actorId` is null for the system or a deleted account; the label stays readable. */
export interface AuditEntryInput {
  actorId: string | null;
  /** A readable name of who acted (« Eric », « system », « stripe webhook »). */
  actorLabel: string;
  /** The product's action, dotted (`billing.checkout_started`, `admin.user_suspended`). */
  action: string;
  target?: { type: string; id: string } | null;
  /** Facts about the action. Never a secret, and as little personal data as the action needs. */
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/** What a store writes: the input, flattened, with its time. */
export interface AuditInsert {
  at: Date;
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
}

/** An entry as read back: its id (a cursor too) and everything written. */
export interface AuditEntry extends AuditInsert {
  id: string;
}

/** How the admin filters the trail. Newest first; `before` is the last id of the previous page. */
export interface AuditFilters {
  actorId?: string;
  actionPrefix?: string;
  target?: { type: string; id: string };
  from?: Date;
  to?: Date;
  limit?: number;
  before?: string;
}

/** Where the trail lives. Every adapter runs `auditStoreContract` (`@krizaka/audit/testkit`). */
export interface AuditStore {
  insert(entry: AuditInsert): Promise<void>;
  list(filters: AuditFilters): Promise<AuditEntry[]>;
  /** Every entry of one actor (Loi 25 export). */
  forActor(actorId: string): Promise<AuditEntry[]>;
  /** Detaches one actor from the trail: id and IP removed, label « erased »; the facts stay. Returns how many entries changed. */
  redactActor(actorId: string): Promise<number>;
  /** Removes the entries older than `before`. Returns how many. */
  purgeBefore(before: Date): Promise<number>;
}

export const AUDIT_CODE = {
  badAction: "AUDIT_BAD_ACTION",
  unknownAction: "AUDIT_UNKNOWN_ACTION",
  badLabel: "AUDIT_BAD_LABEL",
} as const;
export type AuditCode = (typeof AUDIT_CODE)[keyof typeof AUDIT_CODE];

export class AuditError extends Error {
  constructor(
    readonly code: AuditCode,
    readonly value: string,
  ) {
    super(`${code}: ${value}`);
    this.name = "AuditError";
  }
}
