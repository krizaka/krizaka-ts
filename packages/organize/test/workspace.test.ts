import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { type Actor, createWorkspace, memoryWorkspaceStore, type Query, type StatusMove, type WorkspaceEvent } from "../src";
import { fileConfig, INVOICE_STATE } from "./fixtures";

const OWNER: Actor = { id: crypto.randomUUID(), label: "Éric", role: "owner" };
const MANAGER: Actor = { id: crypto.randomUUID(), label: "Léa", role: "manager" };
const STAFF: Actor = { id: crypto.randomUUID(), label: "Sam", role: "staff" };

/** The service over the memory store; the « transaction » runs the work, and a failing one rolls nothing back (none needed here). */
async function setup(config = fileConfig()) {
  const entities = new Map([["file", new Map<string, string>()], ["invoice", new Map<string, string>()]]);
  const store = memoryWorkspaceStore(entities);
  const audit: { action: string; target?: { type: string; id: string } | null; detail?: Record<string, unknown>; actorLabel: string }[] = [];
  const events: WorkspaceEvent[] = [];
  const consequences: StatusMove[][] = [];
  const tx = (async () => []) as Query;
  const ws = createWorkspace({
    transaction: (work) => work(tx),
    storeFor: () => store,
    clock: { now: () => new Date("2026-10-25T12:00:00Z") },
    audit: { record: async (_q, entry) => void audit.push(entry) },
    events: { append: async (_q, event) => void events.push(event) },
    onMoved: async (_q, moves) => void consequences.push([...moves]),
  });
  await ws.config.seed(config);
  const scope = crypto.randomUUID();
  const other = crypto.randomUUID();
  const file = (inScope = scope) => {
    const id = crypto.randomUUID();
    entities.get("file")!.set(id, inScope);
    return id;
  };
  return { ws, store, audit, events, consequences, scope, other, file, entities };
}

describe("the configuration", () => {
  it("is seeded once from code, then the database is the source of truth", async () => {
    const { ws } = await setup();
    const again = await ws.config.seed(fileConfig({ tags: { ...fileConfig().tags, max: 99 } }));
    expect(again).toMatchObject({ version: 1, config: { tags: { max: 5 } } });
  });

  it("is changed by the admin from the version they read, audited; a stale editor is refused", async () => {
    const { ws, audit } = await setup();
    const next = await ws.config.put(OWNER, fileConfig({ tags: { ...fileConfig().tags, userTags: false } }), 1);
    expect(next.version).toBe(2);
    expect(audit.at(-1)).toMatchObject({ action: "organize.config_changed", target: { type: "organize_kind", id: "file" }, detail: { version: 2 } });
    await expect(ws.config.put(OWNER, fileConfig(), 1)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(ws.config.put(OWNER, { kind: "file" }, 2)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("never drops a state entities still hold", async () => {
    const { ws, scope, file } = await setup();
    await ws.status.move(scope, MANAGER, "file", { ids: [file()], to: "en_attente" });
    const set = fileConfig().status!;
    const fewer = { ...set, states: set.states.filter((s) => s.key !== "en_attente"), transitions: set.transitions.filter((t) => t.from !== "en_attente" && t.to !== "en_attente") };
    await expect(ws.config.put(OWNER, fileConfig({ status: fewer }), 1)).rejects.toMatchObject({ code: "STATE_IN_USE", message: "en_attente" });
  });
});

describe("tags", () => {
  it("presets are copied into a scope once, by variant", async () => {
    const { ws, scope } = await setup();
    await ws.tags.seed(scope, "file");
    await ws.tags.seed(scope, "file");
    expect((await ws.tags.list(scope, "file")).map((t) => [t.name, t.marker, t.origin])).toEqual([["Garant", "blue", "preset"], ["Urgent", "red", "preset"]]);
    const shop = crypto.randomUUID();
    expect((await ws.tags.seed(shop, "file", "coiffure")).map((t) => t.name)).toEqual(["Fidèle"]);
  });

  it("writers create them, up to the admin's max; staff read only; users' tags only when the admin allows", async () => {
    const { ws, scope, audit } = await setup();
    const tag = await ws.tags.create(scope, MANAGER, "file", { name: "  À rappeler ", marker: "amber" });
    expect(tag).toMatchObject({ name: "À rappeler", marker: "amber", origin: "user" });
    expect(audit.at(-1)).toMatchObject({ action: "organize.tag_created", actorLabel: "Léa" });
    await expect(ws.tags.create(scope, STAFF, "file", { name: "Non", marker: "red" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ws.tags.create(scope, OWNER, "file", { name: "à rappeler", marker: "red" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(ws.tags.create(scope, OWNER, "file", { name: "Rouge", marker: "#f00" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const n of ["b", "c", "d", "e"]) await ws.tags.create(scope, OWNER, "file", { name: n, marker: "gray" });
    await expect(ws.tags.create(scope, OWNER, "file", { name: "f", marker: "gray" })).rejects.toMatchObject({ code: "TAG_LIMIT" });
    const closed = await setup(fileConfig({ tags: { ...fileConfig().tags, userTags: false } }));
    await expect(closed.ws.tags.create(closed.scope, OWNER, "file", { name: "x", marker: "gray" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("are renamed and removed by writers, and another scope's tag is not found", async () => {
    const { ws, scope, other } = await setup();
    const tag = await ws.tags.create(scope, OWNER, "file", { name: "Garant", marker: "blue" });
    expect(await ws.tags.update(scope, OWNER, "file", tag.id, { marker: "green" })).toMatchObject({ name: "Garant", marker: "green" });
    await expect(ws.tags.update(other, OWNER, "file", tag.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(ws.tags.remove(other, OWNER, "file", tag.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ws.tags.remove(scope, STAFF, "file", tag.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ws.tags.remove(scope, OWNER, "file", tag.id);
    expect(await ws.tags.list(scope, "file")).toEqual([]);
  });

  it("bulk tag and untag: one audit line per entity that changed, and any foreign id refuses the whole call", async () => {
    const { ws, scope, other, file, audit } = await setup();
    const [a, b] = [await ws.tags.create(scope, OWNER, "file", { name: "A", marker: "blue" }), await ws.tags.create(scope, OWNER, "file", { name: "B", marker: "red" })];
    const [x, y, z] = [file(), file(), file()];
    expect(await ws.tags.apply(scope, OWNER, "file", { ids: [x, y], add: [a.id] })).toBe(2);
    expect(await ws.tags.apply(scope, OWNER, "file", { ids: [x, y, z], add: [a.id, b.id] })).toBe(3);
    const lines = audit.filter((e) => e.action === "organize.tags_changed");
    expect(lines.map((e) => e.target?.id)).toEqual([x, y, x, y, z]);
    expect(lines.at(-1)?.detail).toEqual({ added: [a.id, b.id], removed: [] });
    expect(await ws.tags.apply(scope, OWNER, "file", { ids: [x], remove: [a.id] })).toBe(1);
    expect((await ws.tags.of(scope, "file", [x, y])).get(x)?.map((t) => t.name)).toEqual(["B"]);

    const before = audit.length;
    await expect(ws.tags.apply(scope, OWNER, "file", { ids: [y, file(other)], remove: [b.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ws.tags.apply(scope, OWNER, "file", { ids: [y], add: [crypto.randomUUID()] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ws.tags.apply(scope, STAFF, "file", { ids: [y], add: [a.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ws.tags.apply(scope, OWNER, "file", { ids: ["../x"], add: [a.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ws.tags.apply(scope, OWNER, "file", { ids: Array.from({ length: 201 }, () => crypto.randomUUID()), add: [a.id] })).rejects.toMatchObject({ code: "TOO_MANY" });
    expect(audit).toHaveLength(before);
    expect((await ws.tags.of(scope, "file", [y])).get(y)?.map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("an entity's tags become exactly a set; reading leaves out another scope's entities", async () => {
    const { ws, scope, file, other } = await setup();
    const [a, b] = [await ws.tags.create(scope, OWNER, "file", { name: "A", marker: "blue" }), await ws.tags.create(scope, OWNER, "file", { name: "B", marker: "red" })];
    const x = file();
    await ws.tags.set(scope, OWNER, "file", x, [a.id]);
    expect(await ws.tags.set(scope, OWNER, "file", x, [b.id])).toBe(1);
    expect(await ws.tags.set(scope, OWNER, "file", x, [b.id])).toBe(0);
    const read = await ws.tags.of(scope, "file", [x, file(other), "not-an-id", ...Array.from({ length: 300 }, () => crypto.randomUUID())]);
    expect([...read.keys()]).toEqual([x]);
    expect(read.get(x)?.map((t) => t.name)).toEqual(["B"]);
  });
});

describe("status moves", () => {
  it("an entity nobody moved is in the initial state", async () => {
    const { ws, scope, file } = await setup();
    const x = file();
    expect((await ws.status.of(scope, "file", [x])).get(x)).toEqual({ state: "a_decider", changedAt: null });
  });

  it("a move is checked, stored, audited, evented and handed to the product, together", async () => {
    const { ws, scope, file, audit, events, consequences } = await setup();
    const x = file();
    const result = await ws.status.move(scope, OWNER, "file", { ids: [x], to: "non_retenu", expect: "a_decider", reason: "incomplet" });
    const move = { scope, kind: "file", entityId: x, from: "a_decider", to: "non_retenu", final: true, reason: "incomplet", at: new Date("2026-10-25T12:00:00Z") };
    expect(result).toEqual({ moved: [move], skipped: [] });
    expect((await ws.status.of(scope, "file", [x])).get(x)).toEqual({ state: "non_retenu", changedAt: move.at });
    expect(audit.at(-1)).toEqual({ actorId: OWNER.id, actorLabel: "Éric", action: "organize.status_changed", target: { type: "file", id: x }, detail: { set: "decision", from: "a_decider", to: "non_retenu", final: true, reason: "incomplet" } });
    expect(events).toEqual([{ id: expect.any(String), type: "evt.organize.status.changed.v1", scope, payload: { ...move, at: "2026-10-25T12:00:00.000Z" } }]);
    expect(consequences).toEqual([[move]]);
  });

  it("refuses one move that cannot be made, and says why", async () => {
    const { ws, scope, other, file } = await setup();
    const x = file();
    await expect(ws.status.move(scope, MANAGER, "file", { ids: [x], to: "retenu" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(ws.status.move(scope, OWNER, "file", { ids: [x], to: "a_decider" })).rejects.toMatchObject({ code: "ALREADY" });
    await expect(ws.status.move(scope, OWNER, "file", { ids: [x], to: "approuve" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ws.status.move(scope, OWNER, "file", { ids: [x], to: "retenu", reason: "texte libre" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ws.status.move(other, OWNER, "file", { ids: [x], to: "retenu" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await ws.status.move(scope, OWNER, "file", { ids: [x], to: "retenu" });
    await expect(ws.status.move(scope, OWNER, "file", { ids: [x], to: "non_retenu" })).rejects.toMatchObject({ code: "MOVE_NOT_ALLOWED" });
    await expect(ws.status.move(scope, OWNER, "file", { ids: [x], to: "en_attente", expect: "a_decider" })).rejects.toMatchObject({ code: "STALE", status: 409 });
  });

  it("in bulk, moves what can move and names what it skipped, one audit line and one event per entity", async () => {
    const { ws, scope, file, audit, events, consequences } = await setup();
    const [x, y, z] = [file(), file(), file()];
    await ws.status.move(scope, OWNER, "file", { ids: [z], to: "retenu" });
    await ws.status.move(scope, MANAGER, "file", { ids: [y], to: "en_attente" });
    const [auditBefore, eventsBefore] = [audit.length, events.length];
    const result = await ws.status.move(scope, MANAGER, "file", { ids: [x, y, z], to: "en_attente" });
    expect(result.moved.map((m) => m.entityId)).toEqual([x]);
    expect(result.skipped).toEqual([{ id: y, code: "ALREADY" }, { id: z, code: "MOVE_NOT_ALLOWED" }]);
    expect(audit.length - auditBefore).toBe(1);
    expect(events.length - eventsBefore).toBe(1);
    expect(consequences.at(-1)?.map((m) => m.entityId)).toEqual([x]);
    const stale = await ws.status.move(scope, OWNER, "file", { ids: [x, y], to: "retenu", expect: "a_decider" });
    expect(stale.skipped).toEqual([{ id: x, code: "STALE" }, { id: y, code: "STALE" }]);
    expect((await ws.status.move(scope, OWNER, "file", { ids: [x, y], to: "a_decider" })).moved).toHaveLength(2);
  });

  it("a derived set is never moved, and nothing is recorded for it", async () => {
    const { ws, scope, audit, entities } = await setup();
    await ws.config.seed(fileConfig({ kind: "invoice", status: INVOICE_STATE, views: [] }));
    const id = crypto.randomUUID();
    entities.get("invoice")!.set(id, scope);
    const before = audit.length;
    await expect(ws.status.move(scope, OWNER, "invoice", { ids: [id], to: "paid" })).rejects.toMatchObject({ code: "STATUS_DERIVED" });
    await expect(ws.status.of(scope, "invoice", [id])).rejects.toMatchObject({ code: "STATUS_DERIVED" });
    expect(audit).toHaveLength(before);
  });

  it("a kind without a set, or without a configuration, says so", async () => {
    const { ws, scope, file } = await setup(fileConfig({ status: null, views: [] }));
    await expect(ws.status.move(scope, OWNER, "file", { ids: [file()], to: "retenu" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ws.tags.list(scope, "note").then(() => ws.tags.create(scope, OWNER, "note", { name: "x", marker: "gray" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("saved views", () => {
  it("lists the system views, the workspace's, then mine", async () => {
    const { ws, scope } = await setup();
    const mine = await ws.views.create(scope, OWNER, "file", { name: "Mes urgents", filters: { status: ["a_decider"], q: "Tremblay" } });
    const team = await ws.views.create(scope, MANAGER, "file", { name: "Équipe", filters: {}, shared: true });
    await ws.views.create(scope, MANAGER, "file", { name: "Les miens", filters: {} });
    const list = await ws.views.list(scope, OWNER, "file");
    expect(list.system.map((v) => v.key)).toEqual(["a_decider"]);
    expect(list.workspace.map((v) => v.id)).toEqual([team.id]);
    expect(list.mine.map((v) => v.id)).toEqual([mine.id]);
  });

  it("are checked like the address, and changed only by their author", async () => {
    const { ws, scope, other } = await setup();
    await expect(ws.views.create(scope, OWNER, "file", { name: "Score", filters: { sort: "score" } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ws.views.create(scope, OWNER, "file", { name: "Inconnu", filters: { status: ["approuve"] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ws.views.create(scope, { id: null, label: "system", role: "owner" }, "file", { name: "x", filters: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const shared = await ws.views.create(scope, MANAGER, "file", { name: "Équipe", filters: {}, shared: true });
    const own = await ws.views.create(scope, MANAGER, "file", { name: "Privée", filters: {} });
    await expect(ws.views.update(scope, OWNER, shared.id, { name: "Pris" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ws.views.update(scope, OWNER, own.id, { name: "Pris" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ws.views.remove(other, MANAGER, own.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ws.views.update(scope, MANAGER, own.id, { shared: true, filters: { tags: [] } })).toMatchObject({ shared: true, filters: { tags: [] } });
    await expect(ws.views.update(scope, MANAGER, own.id, { shared: "oui" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await ws.views.remove(scope, MANAGER, own.id);
    expect((await ws.views.list(scope, MANAGER, "file")).workspace.map((v) => v.id)).toEqual([shared.id]);
  });
});
