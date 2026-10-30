import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { filterSql, type WorkspaceDecl, workspaceMigration } from "../src";
import { DECISION, INVOICE_STATE } from "./fixtures";

/** Akinaza's shape (demo): invoices scoped to a shop, their derived state read by a SQL function of the product. */
const INVOICE_STATE_SQL_DECL: WorkspaceDecl = {
  scope: "shops",
  users: "accounts",
  kinds: {
    invoice: { table: "invoices", scopeColumn: "shop_id", textColumns: ["number"], stateSql: "invoice_state(e.id)" },
  },
};

describe("the workspace migration", () => {
  it("puts the layer in its own schema, with real foreign keys per kind", () => {
    const sql = workspaceMigration(INVOICE_STATE_SQL_DECL);
    for (const needle of [
      "CREATE SCHEMA IF NOT EXISTS organize;",
      "CREATE TABLE organize.kind_config",
      "scope_id   uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE",
      "marker     text NOT NULL CHECK (marker IN ('blue', 'green', 'amber', 'red', 'violet', 'gray'))",
      "CREATE UNIQUE INDEX tag_scope_kind_name ON organize.tag (scope_id, kind, lower(name))",
      "author_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE",
      "CREATE TABLE organize.invoice_tag",
      "entity_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE",
      "FOREIGN KEY (tag_id, kind) REFERENCES organize.tag (id, kind) ON DELETE CASCADE",
      "CREATE TABLE organize.invoice_status",
    ])
      expect(sql).toContain(needle);
  });

  it("lets only safe identifiers reach SQL", () => {
    expect(() => workspaceMigration({ ...INVOICE_STATE_SQL_DECL, schema: "organize; DROP" })).toThrow(
      /safe SQL identifier/,
    );
    expect(() =>
      workspaceMigration({ ...INVOICE_STATE_SQL_DECL, kinds: { "In-voice": { table: "invoices" } } }),
    ).toThrow(/safe SQL identifier/);
    expect(() =>
      workspaceMigration({
        ...INVOICE_STATE_SQL_DECL,
        kinds: { invoice: { table: "invoices", textColumns: ["name; --"] } },
      }),
    ).toThrow(/safe SQL identifier/);
  });
});

describe("filterSql", () => {
  it("is empty without filters, numbers its parameters from `from`, and passes values as parameters only", () => {
    expect(filterSql(INVOICE_STATE_SQL_DECL, "invoice", {}, { from: 3 })).toEqual({ sql: "", params: [] });
    const where = filterSql(
      INVOICE_STATE_SQL_DECL,
      "invoice",
      { q: "x' OR 1=1 --", status: ["overdue"] },
      { from: 3, status: INVOICE_STATE },
    );
    expect(where.sql).toBe(" AND (invoice_state(e.id)) = ANY($3::text[]) AND (e.number ILIKE $4)");
    expect(where.params).toEqual([["overdue"], "%x' OR 1=1 --%"]);
  });

  it("ignores what the kind does not declare", () => {
    const decl = { ...INVOICE_STATE_SQL_DECL, kinds: { invoice: { table: "invoices", scopeColumn: "shop_id" } } };
    expect(
      filterSql(
        decl,
        "invoice",
        { q: "x", from: "2026-10-01", collection: "11111111-1111-4111-8111-111111111111", status: ["paid"] },
        { from: 1, status: INVOICE_STATE },
      ),
    ).toEqual({ sql: "", params: [] });
    expect(filterSql(decl, "invoice", { status: ["a_decider"] }, { from: 1, status: DECISION }).params).toEqual([
      "a_decider",
      ["a_decider"],
    ]);
    expect(() => filterSql(decl, "client", {}, { from: 1 })).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });
});

describe("the contract entry", () => {
  it("is browser-safe: nothing it reaches imports Node, SQL or the service", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(join(src, file), "utf8");
      expect(text, file).not.toMatch(/from "node:|from "pg"/);
      for (const [, path] of text.matchAll(/from "\.\/([^"]+)"/g)) walk(`${path}.ts`);
    };
    walk("contract.ts");
    expect([...seen].sort()).toEqual([
      "config.ts",
      "contract.ts",
      "errors.ts",
      "port.ts",
      "rules.ts",
      "status-sets.ts",
      "views.ts",
      "workspace-port.ts",
    ]);
  });
});
