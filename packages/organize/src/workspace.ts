/**
 * The workspace, organised (ADR-003): a kind's configuration (the admin's), tags with markers, status moves, saved views and bulk
 * actions, for one scope at a time. The service decides (roles, limits, transitions, tenant isolation); the store keeps. Every
 * change runs in the product's transaction, with its audit lines, its events and the product's own consequence.
 */
import crypto from "node:crypto";

import { checkKindConfig, droppedStates, isMarker, type KindConfig, type Marker } from "./config";
import { ORGANIZE_CODE, OrganizeError } from "./errors";
import type { Query } from "./port";
import { cleanName, isId } from "./rules";
import { checkMove, stateOf, STATUS_MODE, type StatusSet } from "./status-sets";
import { checkViewFilters, type ViewFilters } from "./views";
import {
  type Actor,
  type AuditTrail,
  type Clock,
  type EntityState,
  type SavedView,
  STATUS_CHANGED_EVENT,
  type StatusMove,
  type StoredConfig,
  TAG_ORIGIN,
  type Transaction,
  type WorkspaceEvents,
  type WorkspaceStore,
  type WorkspaceTag,
} from "./workspace-port";

// @fixed: the most entities one bulk action touches; a longer selection is several calls
export const BULK_MAX = 200;

export interface WorkspaceDeps {
  /** The product's transaction: every change runs inside one. */
  transaction: Transaction;
  /** The store over a transaction's query (`dbWorkspaceStore(tx, decl)`, or a memory store in tests). */
  storeFor: (tx: Query) => WorkspaceStore;
  clock: Clock;
  /** The trail: one line per entity changed. Without it nothing is recorded (a product that has none yet). */
  audit?: AuditTrail;
  /** The outbox (or a wrapper over `@krizaka/webhooks`): one event per status move. */
  events?: WorkspaceEvents;
  /** The product's own consequence of moves, in the same transaction (Yomizaka closes the file and purges its documents). */
  onMoved?: (tx: Query, moves: readonly StatusMove[]) => Promise<void>;
  newId?: () => string;
}

/** What a bulk status move did: the moves made, and the entities it left as they were, with why. */
export interface MoveResult {
  moved: StatusMove[];
  skipped: { id: string; code: string }[];
}

const bad = (message: string) => new OrganizeError(ORGANIZE_CODE.badRequest, message);
const name = (raw: unknown) => {
  const clean = typeof raw === "string" ? cleanName(raw) : null;
  if (!clean) throw bad("A name is 1 to 80 characters");
  return clean;
};
const marker = (raw: unknown): Marker => {
  if (!isMarker(raw)) throw bad("Unknown marker");
  return raw;
};
/** Distinct ids, every one a UUID, at most BULK_MAX: a malformed id is a 404 like an id of another scope. */
function ids(raw: readonly string[]): string[] {
  const list = [...new Set(raw)];
  if (list.length > BULK_MAX) throw new OrganizeError(ORGANIZE_CODE.tooMany, `At most ${BULK_MAX} at once`);
  if (list.some((id) => !isId(id))) throw new OrganizeError(ORGANIZE_CODE.notFound);
  return list;
}

/** For reads: the well-formed ids, any number (a list's page); the scope check leaves out the others. */
const readable = (raw: readonly string[]): string[] => [...new Set(raw)].filter(isId);

async function configOf(store: WorkspaceStore, kind: string): Promise<KindConfig> {
  const found = await store.config(kind);
  if (!found) throw new OrganizeError(ORGANIZE_CODE.notFound, `No configuration for ${kind}`);
  return found.config;
}

/** Every id is an entity of the scope, or nothing happens: an id of another scope says nothing about it (404). */
async function owned(
  store: WorkspaceStore,
  scope: string,
  kind: string,
  raw: readonly string[],
  lock = false,
): Promise<string[]> {
  const list = ids(raw);
  const found = await store.inScope(scope, kind, list, { lock });
  if (found.length !== list.length) throw new OrganizeError(ORGANIZE_CODE.notFound);
  return list;
}

async function scopeTags(
  store: WorkspaceStore,
  scope: string,
  kind: string,
  tagIds: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(tagIds)];
  if (wanted.some((t) => !isId(t))) throw new OrganizeError(ORGANIZE_CODE.notFound, "Unknown tag");
  const mine = new Set((await store.tags(scope, kind)).map((t) => t.id));
  if (!wanted.every((t) => mine.has(t))) throw new OrganizeError(ORGANIZE_CODE.notFound, "Unknown tag");
  return wanted;
}

async function authored(store: WorkspaceStore, scope: string, actor: Actor, id: string): Promise<SavedView> {
  const found = isId(id) ? await store.view(scope, id) : null;
  if (!found || (!found.shared && found.authorId !== actor.id)) throw new OrganizeError(ORGANIZE_CODE.notFound);
  if (found.authorId !== actor.id) throw new OrganizeError(ORGANIZE_CODE.forbidden, "Only its author changes a view");
  return found;
}

/**
 * Which entities make a move and which are skipped, with why: the state the user saw (`expect`), then the set's rules. One entity
 * is refused instead of skipped. Pure: the service stores, audits and emits what it returns.
 */
function planMoves(
  set: StatusSet,
  entities: readonly { id: string; from: string }[],
  move: { to: string; role: string; expect?: string; reason?: string | null },
) {
  const single = entities.length === 1;
  const out = { moved: [] as { id: string; from: string }[], skipped: [] as { id: string; code: string }[] };
  const skip = (id: string, error: OrganizeError) => {
    if (single) throw error;
    out.skipped.push({ id, code: error.code });
  };
  for (const { id, from } of entities) {
    const problem =
      move.expect !== undefined && from !== move.expect
        ? new OrganizeError(ORGANIZE_CODE.stale)
        : moveProblem(set, from, move);
    if (problem) skip(id, problem);
    else out.moved.push({ id, from });
  }
  return out;
}

/** Why one entity cannot make a move (`ALREADY` when it is there), or null. A bad reason is the caller's mistake: it is thrown. */
function moveProblem(
  set: StatusSet,
  from: string,
  move: { to: string; role: string; reason?: string | null },
): OrganizeError | null {
  try {
    checkMove(set, { from, to: move.to, role: move.role, reason: move.reason });
    return null;
  } catch (error) {
    if (!(error instanceof OrganizeError) || error.code === ORGANIZE_CODE.badRequest) throw error;
    return from === move.to ? new OrganizeError(ORGANIZE_CODE.already) : error;
  }
}

export function createWorkspace(deps: WorkspaceDeps) {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const audit = (
    tx: Query,
    actor: Actor,
    action: string,
    target: { type: string; id: string },
    detail: Record<string, unknown>,
  ) =>
    deps.audit?.record(tx, { actorId: actor.id, actorLabel: actor.label, action, target, detail }) ?? Promise.resolve();
  const run = <T>(work: (tx: Query, store: WorkspaceStore) => Promise<T>) =>
    deps.transaction((tx) => work(tx, deps.storeFor(tx)));

  const writer = (config: KindConfig, actor: Actor) => {
    if (!config.tags.writers.includes(actor.role)) throw new OrganizeError(ORGANIZE_CODE.forbidden);
  };
  const editableSet = (config: KindConfig): StatusSet & { initial: string } => {
    const set = config.status;
    if (!set) throw bad(`${config.kind} has no status set`);
    if (set.mode !== STATUS_MODE.editable || !set.initial) throw new OrganizeError(ORGANIZE_CODE.statusDerived);
    return set as StatusSet & { initial: string };
  };

  const config = {
    get: (kind: string): Promise<StoredConfig | null> => run((_tx, store) => store.config(kind)),
    /** The product's defaults, written once: the database is the source of truth afterwards. Returns what is stored. */
    seed: (input: KindConfig): Promise<StoredConfig> =>
      run(async (_tx, store) => {
        const valid = checkKindConfig(input);
        const found = await store.config(valid.kind);
        if (found) return found;
        const version = await store.saveConfig(valid.kind, valid, null, deps.clock.now(), null);
        return (await store.config(valid.kind)) ?? { config: valid, version: version ?? 1 };
      }),
    /** The admin's change: checked, refused when stale (`CONFLICT`) or when it drops a state entities hold (`STATE_IN_USE`), audited. */
    put: (actor: Actor, input: unknown, expected: number | null): Promise<StoredConfig> =>
      run(async (tx, store) => {
        const valid = checkKindConfig(input);
        const before = await store.config(valid.kind);
        const inUse = await store.statesInUse(valid.kind, droppedStates(before?.config ?? null, valid));
        if (inUse.length > 0) throw new OrganizeError(ORGANIZE_CODE.stateInUse, inUse.join(", "));
        const version = await store.saveConfig(valid.kind, valid, expected, deps.clock.now(), actor.id);
        if (version === null) throw new OrganizeError(ORGANIZE_CODE.conflict);
        await audit(tx, actor, "organize.config_changed", { type: "organize_kind", id: valid.kind }, { version });
        return { config: valid, version };
      }),
  };

  async function apply(
    tx: Query,
    store: WorkspaceStore,
    actor: Actor,
    kind: string,
    entities: string[],
    change: { add: string[]; remove: string[] | "all-other" },
  ) {
    const current = await store.tagsOf(kind, entities);
    const plans = entities.map((id) => {
      const has = new Set(current.get(id) ?? []);
      const remove =
        change.remove === "all-other"
          ? [...has].filter((t) => !change.add.includes(t))
          : change.remove.filter((t) => has.has(t));
      return { id, added: change.add.filter((t) => !has.has(t)), removed: remove };
    });
    await store.unlink(
      kind,
      plans.flatMap((p) => p.removed.map((tagId) => ({ entityId: p.id, tagId }))),
    );
    await store.link(
      kind,
      plans.flatMap((p) => p.added.map((tagId) => ({ entityId: p.id, tagId }))),
    );
    for (const p of plans.filter((x) => x.added.length + x.removed.length > 0))
      await audit(tx, actor, "organize.tags_changed", { type: kind, id: p.id }, { added: p.added, removed: p.removed });
    return plans.filter((x) => x.added.length + x.removed.length > 0).length;
  }

  const tags = {
    list: (scope: string, kind: string): Promise<WorkspaceTag[]> => run((_tx, store) => store.tags(scope, kind)),
    /** The admin's presets of a variant, copied into the scope once (a name it has already is left alone). */
    seed: (scope: string, kind: string, variant = "default"): Promise<WorkspaceTag[]> =>
      run(async (_tx, store) => {
        const presets = (await configOf(store, kind)).tags.presets[variant] ?? [];
        await store.lockScope(scope);
        const have = new Set((await store.tags(scope, kind)).map((t) => t.name.toLowerCase()));
        for (const p of presets.filter((x) => !have.has(x.name.toLowerCase())))
          await store.addTag(
            scope,
            kind,
            { name: p.name, marker: p.marker, origin: TAG_ORIGIN.preset },
            deps.clock.now(),
          );
        return store.tags(scope, kind);
      }),
    create: (
      scope: string,
      actor: Actor,
      kind: string,
      input: { name: string; marker: Marker },
    ): Promise<WorkspaceTag> =>
      run(async (tx, store) => {
        const cfg = await configOf(store, kind);
        writer(cfg, actor);
        if (!cfg.tags.userTags)
          throw new OrganizeError(ORGANIZE_CODE.forbidden, "Only the administrator's tags exist here");
        const clean = { name: name(input.name), marker: marker(input.marker) };
        await store.lockScope(scope);
        if ((await store.tags(scope, kind)).length >= cfg.tags.max) throw new OrganizeError(ORGANIZE_CODE.tagLimit);
        const tag = await store.addTag(scope, kind, { ...clean, origin: TAG_ORIGIN.user }, deps.clock.now());
        await audit(
          tx,
          actor,
          "organize.tag_created",
          { type: "organize_tag", id: tag.id },
          { kind, name: tag.name, marker: tag.marker },
        );
        return tag;
      }),
    update: (
      scope: string,
      actor: Actor,
      kind: string,
      id: string,
      patch: { name?: string; marker?: Marker },
    ): Promise<WorkspaceTag> =>
      run(async (_tx, store) => {
        writer(await configOf(store, kind), actor);
        if (!isId(id)) throw new OrganizeError(ORGANIZE_CODE.notFound);
        const tag = await store.updateTag(scope, kind, id, {
          name: patch.name === undefined ? undefined : name(patch.name),
          marker: patch.marker === undefined ? undefined : marker(patch.marker),
        });
        if (!tag) throw new OrganizeError(ORGANIZE_CODE.notFound);
        return tag;
      }),
    remove: (scope: string, actor: Actor, kind: string, id: string): Promise<void> =>
      run(async (tx, store) => {
        writer(await configOf(store, kind), actor);
        if (!isId(id) || !(await store.removeTag(scope, kind, id))) throw new OrganizeError(ORGANIZE_CODE.notFound);
        await audit(tx, actor, "organize.tag_removed", { type: "organize_tag", id }, { kind });
      }),
    /** The tags of the scope's entities; ids of another scope are left out. */
    of: (scope: string, kind: string, entityIds: readonly string[]): Promise<Map<string, WorkspaceTag[]>> =>
      run(async (_tx, store) => {
        const mine = await store.inScope(scope, kind, readable(entityIds));
        const byId = new Map((await store.tags(scope, kind)).map((t) => [t.id, t]));
        const worn = await store.tagsOf(kind, mine);
        return new Map(
          mine.map((id) => [
            id,
            (worn.get(id) ?? [])
              .flatMap((t) => (byId.has(t) ? [byId.get(t)!] : []))
              .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
          ]),
        );
      }),
    /** Bulk tag and untag: one transaction, one audit line per entity that changed. Returns how many changed. */
    apply: (
      scope: string,
      actor: Actor,
      kind: string,
      input: { ids: readonly string[]; add?: readonly string[]; remove?: readonly string[] },
    ): Promise<number> =>
      run(async (tx, store) => {
        writer(await configOf(store, kind), actor);
        const entities = await owned(store, scope, kind, input.ids);
        const add = await scopeTags(store, scope, kind, input.add ?? []);
        const remove = (await scopeTags(store, scope, kind, input.remove ?? [])).filter((t) => !add.includes(t));
        return apply(tx, store, actor, kind, entities, { add, remove });
      }),
    /** One entity's tags become exactly these. */
    set: (scope: string, actor: Actor, kind: string, entityId: string, tagIds: readonly string[]): Promise<number> =>
      run(async (tx, store) => {
        writer(await configOf(store, kind), actor);
        const entities = await owned(store, scope, kind, [entityId]);
        return apply(tx, store, actor, kind, entities, {
          add: await scopeTags(store, scope, kind, tagIds),
          remove: "all-other",
        });
      }),
  };

  const status = {
    /** The states of the scope's entities in the kind's editable set (nobody moved it yet: the initial state). */
    of: (scope: string, kind: string, entityIds: readonly string[]): Promise<Map<string, EntityState>> =>
      run(async (_tx, store) => {
        const set = editableSet(await configOf(store, kind));
        const mine = await store.inScope(scope, kind, readable(entityIds));
        const stored = await store.states(kind, mine);
        return new Map(mine.map((id) => [id, stored.get(id) ?? { state: set.initial, changedAt: null }]));
      }),
    /**
     * Moves entities to a state: their rows locked, each move checked against the set and the actor's role, audited, evented, and
     * handed to the product's consequence, all in one transaction. One entity with `expect` (the state the user saw) is refused
     * `STALE` when it changed; in bulk, what cannot move is `skipped` with its code.
     */
    move: (
      scope: string,
      actor: Actor,
      kind: string,
      input: { ids: readonly string[]; to: string; expect?: string; reason?: string | null },
    ): Promise<MoveResult> =>
      run(async (tx, store) => {
        const set = editableSet(await configOf(store, kind));
        const target = stateOf(set, input.to);
        if (!target) throw bad("Not a state of the set");
        const entities = await owned(store, scope, kind, input.ids, true);
        const stored = await store.states(kind, entities);
        const out = planMoves(
          set,
          entities.map((id) => ({ id, from: stored.get(id)?.state ?? set.initial })),
          { ...input, role: actor.role },
        );
        const at = deps.clock.now();
        const moved = out.moved.map((m) => ({
          scope,
          kind,
          entityId: m.id,
          from: m.from,
          to: input.to,
          final: target.final === true,
          reason: input.reason ?? null,
          at,
        }));
        for (const m of moved) {
          await store.setState(kind, m.entityId, m.to, m.at, actor.id);
          await audit(
            tx,
            actor,
            "organize.status_changed",
            { type: kind, id: m.entityId },
            { set: set.key, from: m.from, to: m.to, final: m.final, ...(m.reason ? { reason: m.reason } : {}) },
          );
          await deps.events?.append(tx, {
            id: newId(),
            type: STATUS_CHANGED_EVENT,
            scope,
            payload: { ...m, at: m.at.toISOString() },
          });
        }
        if (moved.length > 0) await deps.onMoved?.(tx, moved);
        return { moved, skipped: out.skipped };
      }),
  };

  const member = (actor: Actor): string => {
    if (!actor.id) throw new OrganizeError(ORGANIZE_CODE.forbidden, "A view belongs to a person");
    return actor.id;
  };

  const views = {
    /** The views of a list, in their order: the product's system views, the workspace's (shared), then mine. */
    list: (scope: string, actor: Actor, kind: string) =>
      run(async (_tx, store) => {
        const cfg = await configOf(store, kind);
        const saved = await store.views(scope, kind, member(actor));
        return { system: cfg.views, workspace: saved.filter((v) => v.shared), mine: saved.filter((v) => !v.shared) };
      }),
    create: (
      scope: string,
      actor: Actor,
      kind: string,
      input: { name: string; filters: ViewFilters; shared?: boolean },
    ): Promise<SavedView> =>
      run(async (_tx, store) => {
        const cfg = await configOf(store, kind);
        const filters = checkViewFilters(input.filters, cfg.status);
        return store.addView(
          scope,
          { kind, authorId: member(actor), name: name(input.name), filters, shared: input.shared === true },
          deps.clock.now(),
        );
      }),
    update: (
      scope: string,
      actor: Actor,
      id: string,
      patch: { name?: string; filters?: ViewFilters; shared?: boolean },
    ): Promise<SavedView> =>
      run(async (_tx, store) => {
        const found = await authored(store, scope, actor, id);
        const filters =
          patch.filters === undefined
            ? undefined
            : checkViewFilters(patch.filters, (await configOf(store, found.kind)).status);
        if (patch.shared !== undefined && typeof patch.shared !== "boolean") throw bad("shared is true or false");
        return (await store.updateView(scope, id, {
          name: patch.name === undefined ? undefined : name(patch.name),
          filters,
          shared: patch.shared,
        }))!;
      }),
    remove: (scope: string, actor: Actor, id: string): Promise<void> =>
      run(async (_tx, store) => {
        await authored(store, scope, actor, id);
        await store.removeView(scope, id);
      }),
  };

  return { config, tags, status, views };
}

export type Workspace = ReturnType<typeof createWorkspace>;
