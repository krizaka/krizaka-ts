import { emitMigration } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";

import { dbMailStore, mailSchema } from "../src";
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

  mailStoreContract("pg", async () => {
    await pool.query(`TRUNCATE ${schema}.delivery, ${schema}.suppression, ${schema}.idempotency`);
    return dbMailStore(query, schema);
  });
});
