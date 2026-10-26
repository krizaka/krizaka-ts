import pg from "pg";
import { afterAll, beforeAll } from "vitest";

import type { Query } from "../src";

/** Against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…). */
export const databaseEnabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;

/**
 * A schema of its own for one suite, its migration run twice (it must be safe), dropped after. One client: statements run one
 * after another. Call inside a `describe`; the returned `query` serves the suite's hooks and tests.
 */
export function testDatabase(prefix: string, migration: string): Query {
  const schemaName = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  let client: pg.Client;
  let queue: Promise<unknown> = Promise.resolve();
  const query: Query = (sql, params) => {
    const run = queue.then(async () => (await client.query(sql, params as unknown[])).rows);
    queue = run.catch(() => undefined);
    return run as never;
  };
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schemaName}; SET search_path TO ${schemaName}`);
    await client.query(migration);
    await client.query(migration);
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await client.end();
  });
  return query;
}
