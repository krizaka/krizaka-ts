import crypto from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Actor, createWorkspace, dbWorkspaceStore, filterSql, type Query, type Transaction, type WorkspaceDecl, workspaceMigration } from "../src";
import { workspaceStoreContract } from "../src/testkit";
import { DECISION, fileConfig } from "./fixtures";

/** The workspace layer against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in schemas of its own per run. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const run = Math.random().toString(36).slice(2, 10);
const product = `wsp_${run}`;
const DECL: WorkspaceDecl = {
  scope: "shops",
  users: "accounts",
  schema: `wso_${run}`,
  kinds: { file: { table: "files", scopeColumn: "shop_id", dateColumn: "received_at", textColumns: ["name", "email"], collectionColumn: "folder_id" }, note: { table: "notes", inScope: "EXISTS (SELECT 1 FROM files f WHERE f.id = e.file_id AND f.shop_id = $1)" } },
};
const OWNER: Actor = { id: null, label: "Éric", role: "owner" };

describe.runIf(enabled)("the workspace layer on PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async (sql, params) => (await pool.query(sql, params as unknown[])).rows as never;
  const transaction: Transaction = async (work) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(async (sql, params) => (await client.query(sql, params as unknown[])).rows as never);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  const shop = async () => (await query<{ id: string }>("INSERT INTO shops DEFAULT VALUES RETURNING id"))[0]!.id;
  const account = async () => (await query<{ id: string }>("INSERT INTO accounts DEFAULT VALUES RETURNING id"))[0]!.id;
  const file = async (scope: string, over: { name?: string; email?: string; received?: string; folder?: string } = {}) =>
    (await query<{ id: string }>("INSERT INTO files (shop_id, name, email, received_at, folder_id) VALUES ($1, $2, $3, $4, $5) RETURNING id", [scope, over.name ?? "Dossier", over.email ?? "demo@example.test", over.received ?? "2026-10-15T12:00:00Z", over.folder ?? null]))[0]!.id;
  const workspace = (onMoved?: Parameters<typeof createWorkspace>[0]["onMoved"]) => createWorkspace({ transaction, storeFor: (tx) => dbWorkspaceStore(tx, DECL), clock: { now: () => new Date("2026-10-25T12:00:00Z") }, onMoved });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${product}`, max: 6 });
    await pool.query(`CREATE SCHEMA ${product}`);
    await query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid())");
    await query("CREATE TABLE shops (id uuid PRIMARY KEY DEFAULT gen_random_uuid())");
    await query("CREATE TABLE files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), name text NOT NULL, email text NOT NULL, received_at timestamptz NOT NULL, folder_id uuid)");
    await query("CREATE TABLE notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), file_id uuid NOT NULL REFERENCES files(id))");
    await pool.query(workspaceMigration(DECL));
    await workspace().config.seed(fileConfig());
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${DECL.schema} CASCADE; DROP SCHEMA ${product} CASCADE`);
    await pool.end();
  });

  workspaceStoreContract("PostgreSQL", "file", async () => ({ store: dbWorkspaceStore(query, DECL), scope: shop, user: account, entity: (scope) => file(scope) }));

  it("the database refuses a tag of another kind on an entity", async () => {
    const scope = await shop();
    const [tag] = await query<{ id: string }>(`INSERT INTO ${DECL.schema}.tag (scope_id, kind, name, marker, origin, created_at) VALUES ($1, 'note', 'N', 'gray', 'user', now()) RETURNING id`, [scope]);
    await expect(query(`INSERT INTO ${DECL.schema}.file_tag (entity_id, tag_id) VALUES ($1, $2)`, [await file(scope), tag!.id])).rejects.toMatchObject({ code: "23503" });
  });

  it("a kind scoped through another table finds only its scope's entities", async () => {
    const [a, b] = [await shop(), await shop()];
    const [note] = await query<{ id: string }>("INSERT INTO notes (file_id) VALUES ($1) RETURNING id", [await file(a)]);
    const store = dbWorkspaceStore(query, DECL);
    expect(await store.inScope(a, "note", [note!.id])).toEqual([note!.id]);
    expect(await store.inScope(b, "note", [note!.id])).toEqual([]);
  });

  it("a move and the product's consequence commit together, or not at all", async () => {
    const scope = await shop();
    const x = await file(scope);
    const failing = workspace(async () => {
      throw new Error("purge failed");
    });
    await expect(failing.status.move(scope, OWNER, "file", { ids: [x], to: "retenu" })).rejects.toThrow("purge failed");
    expect((await workspace().status.of(scope, "file", [x])).get(x)?.state).toBe("a_decider");
    const closing = workspace(async (tx, moves) => void (await tx("UPDATE files SET name = 'Fermé' WHERE id = ANY($1::uuid[])", [moves.map((m) => m.entityId)])));
    await closing.status.move(scope, OWNER, "file", { ids: [x], to: "retenu" });
    expect((await query<{ name: string }>("SELECT name FROM files WHERE id = $1", [x]))[0]?.name).toBe("Fermé");
  });

  it("two people deciding the same file at once give one decision and one STALE", async () => {
    const scope = await shop();
    const x = await file(scope);
    const results = await Promise.allSettled([workspace().status.move(scope, OWNER, "file", { ids: [x], to: "retenu", expect: "a_decider" }), workspace().status.move(scope, OWNER, "file", { ids: [x], to: "non_retenu", expect: "a_decider" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(["STALE"]);
  });

  it("two tags created at once never pass the admin's max", async () => {
    const scope = await shop();
    const ws = workspace();
    for (const n of ["a", "b", "c", "d"]) await ws.tags.create(scope, OWNER, "file", { name: n, marker: "gray" });
    const results = await Promise.allSettled([ws.tags.create(scope, OWNER, "file", { name: "e", marker: "gray" }), ws.tags.create(scope, OWNER, "file", { name: "f", marker: "gray" })]);
    expect(results.map((r) => (r.status === "rejected" ? r.reason.code : "ok")).sort()).toEqual(["TAG_LIMIT", "ok"]);
    expect(await ws.tags.list(scope, "file")).toHaveLength(5);
  });

  it("filterSql selects a list by ALL its tags, its status (the initial one too), its folder, its days and its text", async () => {
    const scope = await shop();
    const ws = workspace();
    const folder = crypto.randomUUID();
    const [a, b] = [await ws.tags.create(scope, OWNER, "file", { name: "A", marker: "blue" }), await ws.tags.create(scope, OWNER, "file", { name: "B", marker: "red" })];
    const both = await file(scope, { name: "Marie Tremblay", received: "2026-10-01T15:00:00Z", folder });
    const onlyA = await file(scope, { name: "Jean 100%_vrai", email: "jean@example.test", received: "2026-10-20T15:00:00Z" });
    const none = await file(scope, { name: "Paul", received: "2026-10-31T15:00:00Z" });
    await ws.tags.apply(scope, OWNER, "file", { ids: [both, onlyA], add: [a.id] });
    await ws.tags.apply(scope, OWNER, "file", { ids: [both], add: [b.id] });
    await ws.status.move(scope, OWNER, "file", { ids: [onlyA], to: "retenu" });
    const list = async (filters: Parameters<typeof filterSql>[2]) => {
      const where = filterSql(DECL, "file", filters, { from: 2, status: DECISION });
      return (await query<{ id: string }>(`SELECT e.id FROM files e WHERE e.shop_id = $1${where.sql} ORDER BY e.received_at`, [scope, ...where.params])).map((r) => r.id);
    };
    expect(await list({})).toEqual([both, onlyA, none]);
    expect(await list({ tags: [a.id, b.id] })).toEqual([both]);
    expect(await list({ tags: [a.id] })).toEqual([both, onlyA]);
    expect(await list({ status: ["a_decider"] })).toEqual([both, none]);
    expect(await list({ status: ["retenu", "non_retenu"] })).toEqual([onlyA]);
    expect(await list({ collection: folder })).toEqual([both]);
    expect(await list({ from: "2026-10-02", to: "2026-10-20" })).toEqual([onlyA]);
    expect(await list({ q: "tremblay" })).toEqual([both]);
    expect(await list({ q: "100%_" })).toEqual([onlyA]);
    expect(await list({ q: "jean@" })).toEqual([onlyA]);
    expect(await list({ q: "%" })).toEqual([onlyA]);
  });
});
