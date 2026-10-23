import pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";

import { followsMigration, pgFollowStore } from "../src";
import { followStoreContract } from "../src/testkit";

const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `follows_${Math.random().toString(36).slice(2, 10)}`;

describe.runIf(enabled)("follow store: PostgreSQL", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(followsMigration());
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  followStoreContract("pg", () => pgFollowStore(async (sql, params) => (await client.query(sql, params as unknown[])).rows), (n) => `subject-${n}`);
});
