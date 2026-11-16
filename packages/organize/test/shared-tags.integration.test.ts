import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbWorkspaceStore, filterSql, type Query, type WorkspaceDecl, workspaceMigration } from "../src";
import { sharedTagListContract } from "../src/testkit";

/** One tag list shared by documents, collections and folders, against a real PostgreSQL (ORGANIZE_DB_IT=1 DATABASE_URL=…). */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const run = Math.random().toString(36).slice(2, 10);
const product = `shp_${run}`;
const DECL: WorkspaceDecl = {
  scope: "accounts",
  users: "people",
  schema: `sho_${run}`,
  kinds: {
    document: {
      table: "documents",
      scopeColumn: "account_id",
      collectionColumn: "collection_id",
      containerKind: "collection",
    },
    collection: { table: "collections", scopeColumn: "account_id", tagList: "document" },
    folder: { table: "folders", scopeColumn: "account_id", tagList: "document" },
  },
};
const TABLE: Record<string, string> = { document: "documents", collection: "collections", folder: "folders" };
const at = new Date("2026-11-16T09:00:00Z");

describe.runIf(enabled)("a tag list shared by several kinds on PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async (sql, params) => (await pool.query(sql, params as unknown[])).rows as never;
  const account = async () => (await query<{ id: string }>("INSERT INTO accounts DEFAULT VALUES RETURNING id"))[0]!.id;
  const entity = async (scope: string, kind: string, collection: string | null = null) =>
    (
      await query<{ id: string }>(
        kind === "document"
          ? "INSERT INTO documents (account_id, collection_id) VALUES ($1, $2) RETURNING id"
          : `INSERT INTO ${TABLE[kind]} (account_id) VALUES ($1) RETURNING id`,
        kind === "document" ? [scope, collection] : [scope],
      )
    )[0]!.id;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${product}`, max: 4 });
    await pool.query(`CREATE SCHEMA ${product}`);
    await query("CREATE TABLE people (id uuid PRIMARY KEY DEFAULT gen_random_uuid())");
    await query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid())");
    for (const t of ["collections", "folders"])
      await query(
        `CREATE TABLE ${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id))`,
      );
    await query(
      "CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id), collection_id uuid REFERENCES collections(id))",
    );
    await pool.query(workspaceMigration(DECL));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${DECL.schema} CASCADE; DROP SCHEMA ${product} CASCADE`);
    await pool.end();
  });

  sharedTagListContract("PostgreSQL", { owner: "document", sharer: "folder" }, async () => ({
    store: dbWorkspaceStore(query, DECL),
    scope: account,
    entity: (scope, kind) => entity(scope, kind),
  }));

  it("a collection and a folder wear the tag of the document list, counted by kind", async () => {
    const store = dbWorkspaceStore(query, DECL);
    const scope = await account();
    const tag = await store.addTag(scope, "collection", { name: "Rosemont", marker: "red", origin: "user" }, at);
    const [c, f, d] = [
      await entity(scope, "collection"),
      await entity(scope, "folder"),
      await entity(scope, "document"),
    ];
    await store.link("collection", [{ entityId: c, tagId: tag.id }]);
    await store.link("folder", [{ entityId: f, tagId: tag.id }]);
    await store.link("document", [{ entityId: d, tagId: tag.id }]);
    expect((await store.counts(scope)).get(tag.id)).toEqual({ collection: 1, folder: 1, document: 1 });
  });

  it("filters documents by a tag they wear or, with inherit, by a tag their collection wears (2 collections × 3 documents)", async () => {
    const store = dbWorkspaceStore(query, DECL);
    const scope = await account();
    const [rosemont, villeray] = [
      await store.addTag(scope, "collection", { name: "Rosemont", marker: "red", origin: "user" }, at),
      await store.addTag(scope, "collection", { name: "Villeray", marker: "blue", origin: "user" }, at),
    ];
    const [c1, c2] = [await entity(scope, "collection"), await entity(scope, "collection")];
    const inC1 = [
      await entity(scope, "document", c1),
      await entity(scope, "document", c1),
      await entity(scope, "document", c1),
    ];
    const inC2 = [
      await entity(scope, "document", c2),
      await entity(scope, "document", c2),
      await entity(scope, "document", c2),
    ];
    await store.link("collection", [
      { entityId: c1, tagId: rosemont.id },
      { entityId: c2, tagId: villeray.id },
    ]);
    await store.link("document", [
      { entityId: inC2[0]!, tagId: rosemont.id },
      { entityId: inC1[0]!, tagId: villeray.id },
    ]);
    const counts = await store.counts(scope);
    expect(counts.get(rosemont.id)).toEqual({ collection: 1, document: 1 });
    expect(counts.get(villeray.id)).toEqual({ collection: 1, document: 1 });
    const ids = async (tags: string[], inherit: boolean) => {
      const f = filterSql(DECL, "document", { tags }, { from: 2, inherit });
      return (
        await query<{ id: string }>(`SELECT e.id FROM documents e WHERE e.account_id = $1${f.sql}`, [
          scope,
          ...f.params,
        ])
      )
        .map((r) => r.id)
        .sort();
    };
    expect(await ids([rosemont.id], false)).toEqual([inC2[0]!]);
    expect(await ids([rosemont.id], true)).toEqual([...inC1, inC2[0]!].sort());
    expect(await ids([rosemont.id, villeray.id], true)).toEqual([inC1[0]!, inC2[0]!].sort());
    expect(await ids([villeray.id], true)).toEqual([...inC2, inC1[0]!].sort());
  });

  it("the database refuses a tag of another list on a folder", async () => {
    const scope = await account();
    const [tag] = await query<{ id: string }>(
      `INSERT INTO ${DECL.schema}.tag (scope_id, kind, name, marker, origin, created_at) VALUES ($1, 'folder', 'F', 'gray', 'user', now()) RETURNING id`,
      [scope],
    );
    await expect(
      query(`INSERT INTO ${DECL.schema}.folder_tag (entity_id, tag_id) VALUES ($1, $2)`, [
        await entity(scope, "folder"),
        tag!.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
