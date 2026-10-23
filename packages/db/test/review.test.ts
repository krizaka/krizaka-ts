import { describe, expect, it } from "vitest";

import { type Connection, DB_CODE, defineModule, emitMigration, migrate, transaction } from "../src";
import { assertEmbedded, createTestDatabase } from "../src/testing";

/** Regression tests for the review of #63 (krizaka-ts#50). */

const base = defineModule({ module: "base", migrations: [{ version: 1, name: "b", sql: (c) => `CREATE TABLE ${c.schema}.b (id int);` }] });
const dependent = defineModule({ module: "dependent", requires: ["base"], migrations: [{ version: 1, name: "d", sql: (c) => `CREATE TABLE ${c.schema}.d (id int);` }] });
const modules = [{ schema: base, context: { tables: {} } }, { schema: dependent, context: { tables: {} } }];

describe("the drift test reads the SQL, not only the marker", () => {
  it("refuses an embedded version whose DDL was edited but whose marker was kept", () => {
    const edited = emitMigration(dependent, 1, { tables: {} }).replace("(id int)", "(id text)");
    expect(() => assertEmbedded([emitMigration(base, 1, { tables: {} }), edited], modules)).toThrow(expect.objectContaining({ code: DB_CODE.frozenChanged, details: ["dependent v1"] }));
  });

  it("refuses a marker whose DDL was deleted", () => {
    const markerOnly = emitMigration(dependent, 1, { tables: {} }).replace("CREATE TABLE dependent.d (id int);", "");
    expect(() => assertEmbedded([emitMigration(base, 1, { tables: {} }), markerOnly], modules)).toThrow(expect.objectContaining({ code: DB_CODE.frozenChanged }));
  });

  it("accepts the same text with other whitespace", () => {
    const reflowed = emitMigration(dependent, 1, { tables: {} }).replace(/\n/g, "\n\n  ");
    expect(() => assertEmbedded([emitMigration(base, 1, { tables: {} }), reflowed], modules)).not.toThrow();
  });

  it("refuses a dependent placed before its prerequisite inside one file", () => {
    const oneFile = emitMigration(dependent, 1, { tables: {} }) + emitMigration(base, 1, { tables: {} });
    expect(() => assertEmbedded([oneFile], modules)).toThrow(expect.objectContaining({ code: DB_CODE.order }));
    expect(() => assertEmbedded([emitMigration(base, 1, { tables: {} }) + emitMigration(dependent, 1, { tables: {} })], modules)).not.toThrow();
  });
});

describe("a module sees only the tables it declared", () => {
  it("refuses a table the product supplies but the module did not declare", () => {
    const sneaky = defineModule({ module: "sneaky", tables: [], migrations: [{ version: 1, name: "s", sql: (c) => `CREATE TABLE ${c.schema}.s (o uuid REFERENCES ${c.tables.owner}(id));` }] });
    expect(() => emitMigration(sneaky, 1, { tables: { owner: "accounts" } })).toThrow(expect.objectContaining({ code: DB_CODE.undeclaredTable, details: ["sneaky did not declare the table « owner »"] }));
  });
});

describe("the test database's name fits PostgreSQL's 63 bytes", () => {
  it("refuses a prefix that would push the random suffix past the limit, before any SQL", async () => {
    let connected = 0;
    const connect = async (): Promise<Connection> => { connected++; return { query: async () => ({ rows: [] }), release() {} }; };
    await expect(createTestDatabase({ connect, migrate: async () => {}, prefix: "p".repeat(48) })).rejects.toMatchObject({ code: DB_CODE.unsafeIdentifier });
    expect(connected).toBe(0);
  });
});

/** A connection whose statement `failOn` throws, and whose ROLLBACK or DROP may reject too. */
function failing(failOn: string, cleanupFails: boolean): () => Promise<Connection> {
  return async () => ({
    async query(sql: string) {
      if (sql.startsWith(failOn)) throw new Error("work failed");
      if (cleanupFails && (sql === "ROLLBACK" || sql.startsWith("DROP DATABASE"))) throw new Error("cleanup failed");
      return { rows: [] };
    },
    release() {},
  });
}

describe("a failing cleanup never hides the original failure", () => {
  const both = (error: unknown) => {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(["work failed", "cleanup failed"]);
  };

  it("transaction: the work's error first, then the rollback's", async () => {
    both(await transaction(failing("UPDATE", true), async (query) => { await query("UPDATE x"); }).catch((e: unknown) => e));
  });

  it("transaction: a clean rollback rethrows the work's error as it is", async () => {
    await expect(transaction(failing("UPDATE", false), async (query) => { await query("UPDATE x"); })).rejects.toThrow("work failed");
  });

  it("migrate: the migration's error first, then the rollback's", async () => {
    both(await migrate(failing("CREATE TABLE t", true), [{ version: "1", sql: "CREATE TABLE t (id int)" }], { lockKey: 1 }).catch((e: unknown) => e));
  });

  it("createTestDatabase: the migration's error first, then the drop's", async () => {
    const connect = failing("never", true);
    both(await createTestDatabase({ connect, migrate: async () => { throw new Error("work failed"); }, prefix: "kz" }).catch((e: unknown) => e));
  });
});
