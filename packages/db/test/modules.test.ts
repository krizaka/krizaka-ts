import { describe, expect, it } from "vitest";

import { adoptMigration, assertModules, checksumOf, DB_CODE, DbError, defineModule, emitMigration, ident, type Query } from "../src";

const audit = defineModule({
  module: "audit",
  tables: ["owner"],
  migrations: [
    { version: 1, name: "entries", sql: (c) => `CREATE TABLE ${c.schema}.entry (id bigserial PRIMARY KEY, actor_id uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL);` },
    { version: 2, name: "action index", sql: (c) => `CREATE INDEX entry_action ON ${c.schema}.entry (id);` },
  ],
});
const context = { tables: { owner: "accounts" } };

describe("identifiers", () => {
  it("accepts lower-case SQL identifiers and refuses anything else", () => {
    expect(ident("accounts")).toBe("accounts");
    expect(ident("_shop_2")).toBe("_shop_2");
    for (const bad of ["Accounts", "1table", "accounts; DROP TABLE x", "a-b", "", "x".repeat(64)]) {
      expect(() => ident(bad)).toThrow(DbError);
    }
  });
});

describe("a module schema", () => {
  it("defaults its Postgres schema to the module's name, and may be renamed by the product", () => {
    expect(emitMigration(audit, 1, context)).toContain("CREATE SCHEMA IF NOT EXISTS audit;");
    expect(emitMigration(audit, 1, { ...context, schema: "kz_audit" })).toContain("CREATE TABLE kz_audit.entry");
  });

  it("refuses versions that are not 1, 2, 3… in order, and a module name that is not an identifier", () => {
    expect(() => defineModule({ module: "x", migrations: [{ version: 2, name: "a", sql: () => "" }] })).toThrow(/1, 2, 3/);
    expect(() => defineModule({ module: "Bad-Name", migrations: [] })).toThrow(DbError);
  });

  it("fails when the product does not declare a table the module needs, or declares an unsafe name", () => {
    expect(() => emitMigration(audit, 1, { tables: {} })).toThrow(/owner/);
    expect(() => emitMigration(audit, 1, { tables: { owner: "accounts; --" } })).toThrow(DbError);
  });

  it("has a stable checksum per version and context: the frozen-version guard", () => {
    const one = checksumOf(audit, 1, context);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(checksumOf(audit, 1, context)).toBe(one);
    expect(checksumOf(audit, 1, { tables: { owner: "users" } })).not.toBe(one);
    expect(checksumOf(audit, 2, context)).not.toBe(one);
  });
});

describe("emitting a version into the product's sequence", () => {
  it("creates the schema and the marker table, runs the version's SQL, then writes its marker", () => {
    const sql = emitMigration(audit, 1, context);
    const order = ["CREATE TABLE IF NOT EXISTS public.krizaka_module_versions", "CREATE SCHEMA IF NOT EXISTS audit;", "CREATE TABLE audit.entry", "INSERT INTO public.krizaka_module_versions"];
    const positions = order.map((part) => sql.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(sql).toContain(`('audit', 1, '${checksumOf(audit, 1, context)}')`);
    expect(sql).toContain("ON CONFLICT (module, version) DO NOTHING");
  });

  it("refuses a version the module does not have", () => {
    expect(() => emitMigration(audit, 3, context)).toThrow(expect.objectContaining({ code: DB_CODE.unknownVersion }));
  });

  it("adopts tables that already exist with the marker alone, no DDL", () => {
    const sql = adoptMigration(audit, 2, context);
    expect(sql).not.toContain("CREATE TABLE audit");
    expect(sql).not.toContain("CREATE INDEX");
    expect(sql).toContain(`('audit', 1, '${checksumOf(audit, 1, context)}')`);
    expect(sql).toContain(`('audit', 2, '${checksumOf(audit, 2, context)}')`);
  });
});

describe("the boot check", () => {
  const markers = (rows: { module: string; version: number; checksum: string }[]): Query =>
    (async (sql: string) => (sql.includes("to_regclass") ? [{ present: rows.length > 0 ? "public.krizaka_module_versions" : null }] : rows)) as Query;

  it("passes when every version the code knows is in the database", async () => {
    const rows = [1, 2].map((version) => ({ module: "audit", version, checksum: checksumOf(audit, version, context) }));
    await expect(assertModules(markers(rows), [{ schema: audit, context }])).resolves.toBeUndefined();
  });

  it("lists every missing version", async () => {
    const rows = [{ module: "audit", version: 1, checksum: checksumOf(audit, 1, context) }];
    await expect(assertModules(markers(rows), [{ schema: audit, context }])).rejects.toMatchObject({ code: DB_CODE.missingModules, details: ["audit v2"] });
  });

  it("refuses a version whose SQL changed after it was applied", async () => {
    const rows = [1, 2].map((version) => ({ module: "audit", version, checksum: version === 1 ? "0".repeat(64) : checksumOf(audit, version, context) }));
    await expect(assertModules(markers(rows), [{ schema: audit, context }])).rejects.toMatchObject({ code: DB_CODE.frozenChanged, details: ["audit v1"] });
  });

  it("says every version is missing on a database that never ran a module", async () => {
    await expect(assertModules(markers([]), [{ schema: audit, context }])).rejects.toMatchObject({ details: ["audit v1", "audit v2"] });
  });
});
