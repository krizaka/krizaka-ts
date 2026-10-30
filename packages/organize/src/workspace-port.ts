/**
 * The ports of the workspace layer (ADR-003): the store the service reads and writes through, the audit trail and the events it
 * writes to, and the record types. Nothing here knows a database client, the wall clock or a product.
 */
import type { Clock } from "@krizaka/db";

import type { KindConfig, Marker } from "./config";
import type { Query } from "./port";
import type { ViewFilters } from "./views";

/** Who acts, as the product authorised them: their id (null for the system), a readable label, their role in the scope. */
export interface Actor {
  id: string | null;
  label: string;
  role: string;
}

export const TAG_ORIGIN = { preset: "preset", user: "user" } as const;
export type TagOrigin = (typeof TAG_ORIGIN)[keyof typeof TAG_ORIGIN];

/** A tag of a scope, for one kind. */
export interface WorkspaceTag {
  id: string;
  kind: string;
  name: string;
  marker: Marker;
  origin: TagOrigin;
}

/** A view a member saved: theirs, or the workspace's when shared. */
export interface SavedView {
  id: string;
  kind: string;
  authorId: string;
  name: string;
  filters: ViewFilters;
  shared: boolean;
}

/** The stored configuration of a kind and its version (a stale editor is refused). */
export interface StoredConfig {
  config: KindConfig;
  version: number;
}

/** An entity's state in its kind's editable set; `changedAt` is null while nobody moved it (the initial state). */
export interface EntityState {
  state: string;
  changedAt: Date | null;
}

/** One move made: what the audit line, the event and the product's consequence receive. */
export interface StatusMove {
  scope: string;
  kind: string;
  entityId: string;
  from: string;
  to: string;
  final: boolean;
  reason: string | null;
  at: Date;
}

/**
 * Where the layer lives. Every adapter runs `workspaceStoreContract` (`@krizaka/organize/testkit`). The store checks nothing
 * the service decides (roles, limits, transitions); it keeps the database's invariants (names unique per scope and kind).
 */
export interface WorkspaceStore {
  config(kind: string): Promise<StoredConfig | null>;
  /** Writes a configuration when the stored version is `expected` (null: none yet). Returns the new version, or null on a conflict. */
  saveConfig(
    kind: string,
    config: KindConfig,
    expected: number | null,
    at: Date,
    by: string | null,
  ): Promise<number | null>;
  /** Which of these ids are entities of the scope; with `lock`, their rows are locked until the transaction ends. */
  inScope(scope: string, kind: string, ids: readonly string[], options?: { lock?: boolean }): Promise<string[]>;
  /** Locks the scope's row until the transaction ends: a count and the insert it allows never race. */
  lockScope(scope: string): Promise<void>;
  tags(scope: string, kind: string): Promise<WorkspaceTag[]>;
  /** Throws OrganizeError `NAME_TAKEN` when the scope has that name for that kind (case ignored). */
  addTag(
    scope: string,
    kind: string,
    tag: { name: string; marker: Marker; origin: TagOrigin },
    at: Date,
  ): Promise<WorkspaceTag>;
  /** Null when the tag is not the scope's; throws `NAME_TAKEN` like `addTag`. */
  updateTag(
    scope: string,
    kind: string,
    id: string,
    patch: { name?: string; marker?: Marker },
  ): Promise<WorkspaceTag | null>;
  removeTag(scope: string, kind: string, id: string): Promise<boolean>;
  /** The tag ids each entity wears, in no order. */
  tagsOf(kind: string, entityIds: readonly string[]): Promise<Map<string, string[]>>;
  link(kind: string, pairs: readonly { entityId: string; tagId: string }[]): Promise<void>;
  unlink(kind: string, pairs: readonly { entityId: string; tagId: string }[]): Promise<void>;
  /** The stored states (an entity nobody moved has none). */
  states(kind: string, entityIds: readonly string[]): Promise<Map<string, { state: string; changedAt: Date }>>;
  setState(kind: string, entityId: string, state: string, at: Date, by: string | null): Promise<void>;
  /** Which of these states some entity of the kind holds. */
  statesInUse(kind: string, states: readonly string[]): Promise<string[]>;
  /** The views of a scope and kind that are shared, or the user's. */
  views(scope: string, kind: string, userId: string): Promise<SavedView[]>;
  view(scope: string, id: string): Promise<SavedView | null>;
  /** Throws `NAME_TAKEN` when the author has a view of that name for that kind. */
  addView(scope: string, view: Omit<SavedView, "id">, at: Date): Promise<SavedView>;
  updateView(
    scope: string,
    id: string,
    patch: { name?: string; filters?: ViewFilters; shared?: boolean },
  ): Promise<SavedView | null>;
  removeView(scope: string, id: string): Promise<boolean>;
}

/** The audit trail, by shape: `@krizaka/audit`'s `createAudit(…)` fits. */
export interface AuditTrail {
  record(
    query: Query,
    entry: {
      actorId: string | null;
      actorLabel: string;
      action: string;
      target?: { type: string; id: string } | null;
      detail?: Record<string, unknown>;
    },
  ): Promise<void>;
}

/** The status event (ADR-001's routing-key form). */
export const STATUS_CHANGED_EVENT = "evt.organize.status.changed.v1";

export interface WorkspaceEvent {
  id: string;
  type: typeof STATUS_CHANGED_EVENT;
  scope: string;
  payload: Omit<StatusMove, "at"> & { at: string };
}

/** Where events go, in the caller's transaction: the product's outbox, or a wrapper over `@krizaka/webhooks`' `emit`. */
export interface WorkspaceEvents {
  append(query: Query, event: WorkspaceEvent): Promise<void>;
}

/** The product's transaction: runs the work on one connection, commits when it resolves, rolls back when it throws. */
export type Transaction = <T>(work: (tx: Query) => Promise<T>) => Promise<T>;

/** The clock, injected: `@krizaka/db`'s `Clock`; the layer never reads the wall clock. */
export type { Clock };
