import { describe, expect, it } from "vitest";

import { type Connection, queryOf, transaction } from "../src";

function fakeConnection() {
  const log: string[] = [];
  let released = 0;
  const connection: Connection = {
    async query(sql) { log.push(sql); return { rows: sql.startsWith("SELECT") ? [{ one: 1 }] : [] }; },
    release() { released++; },
  };
  return { log, connection, released: () => released };
}

describe("a transaction", () => {
  it("commits when the work returns, and gives its result back", async () => {
    const fake = fakeConnection();
    const result = await transaction(async () => fake.connection, async (query) => (await query("SELECT 1")).length);
    expect(result).toBe(1);
    expect(fake.log).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(fake.released()).toBe(1);
  });

  it("rolls back and rethrows when the work throws, and still releases the connection", async () => {
    const fake = fakeConnection();
    await expect(transaction(async () => fake.connection, async (query) => { await query("UPDATE x"); throw new Error("no"); })).rejects.toThrow("no");
    expect(fake.log).toEqual(["BEGIN", "UPDATE x", "ROLLBACK"]);
    expect(fake.released()).toBe(1);
  });
});

describe("a Query over a connection", () => {
  it("returns the rows and passes the parameters", async () => {
    const seen: unknown[][] = [];
    const query = queryOf({ async query(_sql, params) { seen.push(params ?? []); return { rows: [{ id: "a" }] }; }, release() {} });
    expect(await query<{ id: string }>("SELECT id FROM t WHERE x = $1", ["v"])).toEqual([{ id: "a" }]);
    expect(seen).toEqual([["v"]]);
  });
});
