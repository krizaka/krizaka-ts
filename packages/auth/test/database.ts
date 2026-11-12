import pg from "pg";

import type { Query } from "../src";

/** One client for a suite: its statements run one after another, as a single connection requires. */
export function serialQuery(client: () => pg.Client): Query {
  let queue: Promise<unknown> = Promise.resolve();
  return (sql, params) => {
    const run = queue.then(async () => (await client().query(sql, params as unknown[])).rows);
    queue = run.catch(() => undefined);
    return run as never;
  };
}

/** A real transaction on its own connection (the product's pool does this), in the suite's schema; rolled back when the work throws, whose error is the one thrown. */
export function transactionIn(schemaName: () => string) {
  return async <T>(work: (q: Query) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query(`SET search_path TO ${schemaName()}; BEGIN`);
      const result = await work(async (sql, params) => (await c.query(sql, params as unknown[])).rows as never);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await c.end();
    }
  };
}
