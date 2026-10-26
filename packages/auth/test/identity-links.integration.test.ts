import pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";

import { dbIdentityLinks, identityLinksMigration } from "../src";
import { identityLinkStoreContract } from "../src/testkit";

/** The links against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `fed_${Math.random().toString(36).slice(2, 10)}`;

describe.runIf(enabled)("identity links: PostgreSQL", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await client.query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL)");
    await client.query(identityLinksMigration());
    await client.query(identityLinksMigration()); // idempotent
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  const accounts = new Map<number, string>();
  const account = async (n: number) => {
    if (!accounts.has(n)) accounts.set(n, (await client.query("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`f-${n}-${Math.random().toString(36).slice(2)}@test`])).rows[0].id);
    return accounts.get(n)!;
  };
  identityLinkStoreContract("pg", () => dbIdentityLinks(async (sql, params) => (await client.query(sql, params as unknown[])).rows), account);
});
