import pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";

import { apiKeysMigration, pgApiKeyStore } from "../src";
import { apiKeyStoreContract } from "../src/testkit";

/** The PostgreSQL adapter against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own: the same contract as the memory one. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `keys_${Math.random().toString(36).slice(2, 10)}`;

describe.runIf(enabled)("api key store: PostgreSQL", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await client.query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL)");
    await client.query(apiKeysMigration());
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  const owners = new Map<number, string>();
  const owner = async (n: number) => {
    if (!owners.has(n)) owners.set(n, (await client.query("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`k-${n}-${Math.random().toString(36).slice(2)}@test`])).rows[0].id);
    return owners.get(n)!;
  };
  apiKeyStoreContract("pg", () => pgApiKeyStore(async (sql, params) => (await client.query(sql, params as unknown[])).rows), owner);
});
