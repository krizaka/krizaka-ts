import { rethrowAfter } from "./cleanup";
import type { Connect, Connection, Query } from "./port";

/**
 * A `Query` over one connection: the rows of each statement.
 * @param connection an open connection
 * @returns the query function modules take
 */
export function queryOf(connection: Connection): Query {
  return async <T>(sql: string, params?: unknown[]) => (await connection.query(sql, params)).rows as T[];
}

/**
 * Runs `work` in one transaction: `BEGIN`, the work with its `Query`, then `COMMIT`, or `ROLLBACK` when the work throws.
 * The connection is always released. Every module function that joins a unit of work takes this `Query` (ADR-001 §4).
 * @param connect opens a connection (the product's pool)
 * @param work the use case, writing only through the `Query` it receives
 * @returns what the work returns
 * @throws whatever the work throws, after the rollback; an `AggregateError` (the work's error first) if the rollback fails too
 */
export async function transaction<T>(connect: Connect, work: (query: Query) => Promise<T>): Promise<T> {
  const connection = await connect();
  try {
    await connection.query("BEGIN");
    try {
      const result = await work(queryOf(connection));
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      return await rethrowAfter(error, () => connection.query("ROLLBACK"));
    }
  } finally {
    await connection.release();
  }
}
