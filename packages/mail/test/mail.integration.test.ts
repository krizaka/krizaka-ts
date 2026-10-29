import { emitMigration } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbMailStore, hashAddress, mailSchema } from "../src";
import { mailStoreContract } from "../src/testkit";

/** The store against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `ml_${Math.random().toString(36).slice(2, 10)}`;

describe.runIf(enabled)("mail: PostgreSQL", () => {
  let pool: pg.Pool;
  const query = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    await pool.query(emitMigration(mailSchema, 1, { tables: {}, schema }));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("keeps the recipient as a hash in the tables: no address is stored", async () => {
    const store = dbMailStore(query, schema);
    await store.record({
      at: new Date("2026-10-26T12:00:00Z"),
      template: "reset",
      category: "transactional",
      locale: "en",
      to: hashAddress("ana@example.com"),
      status: "sent",
    });
    await store.suppress(hashAddress("ana@example.com"), "bounce", new Date("2026-10-26T12:00:00Z"));
    const rows = await query(
      `SELECT to_hash AS v FROM ${schema}.delivery UNION ALL SELECT address_hash FROM ${schema}.suppression`,
    );
    expect(JSON.stringify(rows)).not.toContain("ana@example.com");
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  mailStoreContract("pg", async () => {
    await pool.query(`TRUNCATE ${schema}.delivery, ${schema}.suppression, ${schema}.idempotency`);
    return dbMailStore(query, schema);
  });
});
