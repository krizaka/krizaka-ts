import { emitMigration } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLimiter, dbLimitStore, rateLimitSchema } from "../src";
import { limitStoreContract } from "../src/testkit";

/** The database store against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `rl_${Math.random().toString(36).slice(2, 10)}`;
const NOW = new Date("2026-10-26T12:00:00.000Z");

describe.runIf(enabled)("rate limits: PostgreSQL", () => {
  let pool: pg.Pool;
  const query = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    await pool.query(emitMigration(rateLimitSchema, 1, { tables: {}, schema }));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });
  const fresh = async () => {
    await pool.query(`TRUNCATE ${schema}.bucket`);
    return dbLimitStore(query, { schema });
  };

  limitStoreContract("pg", fresh);

  it("counts exactly under concurrency through the limiter: 100 parallel checks, 60 allowed and 40 refused", async () => {
    const store = await fresh();
    const limiter = createLimiter({ store, clock: { now: () => NOW }, limits: { burst: { perIp: 60, windowSeconds: 60 } } });
    const results = await Promise.all(Array.from({ length: 100 }, () => limiter.check("burst", { ip: "203.0.113.7" })));
    expect(results.filter((r) => r.ok)).toHaveLength(60);
    expect(results.filter((r) => !r.ok)).toHaveLength(40);
    expect((await store.peek("burst:ip:203.0.113.7", NOW))?.count).toBe(100);
  });

  it("is shared by two instances of the app: two stores over the same table see one count", async () => {
    await fresh();
    const a = dbLimitStore(query, { schema });
    const b = dbLimitStore(query, { schema });
    await a.hit("shared", 60, NOW);
    expect((await b.hit("shared", 60, NOW)).count).toBe(2);
  });
});

describe("the database store's names", () => {
  it("refuses an unsafe schema name", () => {
    expect(() => dbLimitStore(async () => [], { schema: "rate_limit; DROP TABLE x" })).toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
