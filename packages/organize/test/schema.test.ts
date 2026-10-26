import { createHash } from "node:crypto";

import { adoptMigration, checksumOf, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { organizeMigration, type OrganizeSchema, organizeSchema, type WorkspaceDecl, workspaceMigration, workspaceSchema } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** SHA-256 of what the old functions returned before the module schemas existed (recorded from that code). */
const BEFORE = {
  organizeDefault: "b2a542f5c97f66bfb8b3469e099ab9ff72de76e2c1580508e0f3604d947b9fc8",
  organizeRich: "29ce30fca8e7b9165be7a0bf4176a057309ee614873e7e736690d7beeccc70b3",
  workspace: "87b2d5986304e1b1401ae391dac137f1694bea393a1a11140103cc00f4f315f4",
  workspaceSchema: "72bb2c7069f3400277a1cfc7fbb389d13367220c2b87b1a90c7400f8a473e8f6",
};
const DEFAULT: OrganizeSchema = { kinds: { file: { table: "files" } } };
const RICH: OrganizeSchema = {
  owner: { table: "users", localeColumn: "lang" },
  collections: "folders",
  tags: "labels",
  collectionTags: "folder_labels",
  defaultName: { fr: "Mes dossiers", en: "My folders" },
  kinds: { file: { table: "files", ownerColumn: "user_id", tagTable: "file_labels", tagColumn: "file_id" }, note: { table: "notes", inCollection: false } },
};
const WORKSPACE: WorkspaceDecl = { scope: "shops", users: "accounts", kinds: { invoice: { table: "invoices", scopeColumn: "shop_id", textColumns: ["number"], stateSql: "invoice_state(e.id)" }, file: { table: "files" } } };
const none = { schema: "public", tables: {} };

describe("the organize schemas", () => {
  it("version 1 is byte-identical to the SQL shipped before the module schemas", () => {
    expect(sha(organizeSchema(DEFAULT).migrations[0]!.sql(none))).toBe(BEFORE.organizeDefault);
    expect(sha(organizeSchema(RICH).migrations[0]!.sql(none))).toBe(BEFORE.organizeRich);
    expect(sha(workspaceSchema(WORKSPACE).migrations[0]!.sql({ schema: "organize", tables: {} }))).toBe(BEFORE.workspace);
    expect(sha(workspaceSchema({ ...WORKSPACE, schema: "ws" }).migrations[0]!.sql({ schema: "ws", tables: {} }))).toBe(BEFORE.workspaceSchema);
  });

  it("keeps the old functions as wrappers over version 1", () => {
    expect(sha(organizeMigration(DEFAULT))).toBe(BEFORE.organizeDefault);
    expect(sha(organizeMigration(RICH))).toBe(BEFORE.organizeRich);
    expect(sha(workspaceMigration(WORKSPACE))).toBe(BEFORE.workspace);
    expect(sha(workspaceMigration({ ...WORKSPACE, schema: "ws" }))).toBe(BEFORE.workspaceSchema);
  });

  it("is frozen; the collections are adopted in `public`, the workspace layer lives in its own schema", () => {
    expect(checksumOf(organizeSchema(DEFAULT), 1, { tables: {} })).toBe(BEFORE.organizeDefault);
    expect(checksumOf(workspaceSchema(WORKSPACE), 1, { tables: {} })).toBe(BEFORE.workspace);
    expect(adoptMigration(organizeSchema(DEFAULT), 1, { tables: {} })).toContain(`('organize', 1, '${BEFORE.organizeDefault}')`);
    expect(emitMigration(workspaceSchema(WORKSPACE), 1, { tables: {} })).toContain("CREATE TABLE organize.kind_config");
    expect(workspaceSchema({ ...WORKSPACE, schema: "ws" }).schema).toBe("ws");
  });

  it("refuses a declaration with an unsafe name when the SQL is generated", () => {
    expect(() => emitMigration(organizeSchema({ kinds: { shop: { table: "shops; DROP" } } }), 1, { tables: {} })).toThrow(/safe SQL identifier/);
  });
});
