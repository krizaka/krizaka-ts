/**
 * The ports of « db »: what every Krizaka module and product shares to reach PostgreSQL, with no database client in the
 * package. A product passes its own (`pg`, a pool, drizzle's client): `pg`'s `PoolClient` and `Client` satisfy `Connection`.
 */

/** Runs one SQL statement with its parameters and returns the rows: a pool, or the client of an open transaction. */
export type Query = <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<T[]>;

/** One connection to the database. `release` gives it back to its pool, or closes it. */
export interface Connection {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void | Promise<void>;
}

/** Opens a connection (from the product's pool). */
export type Connect = () => Promise<Connection>;

/** The clock, injected: domain code never calls `new Date()`. */
export interface Clock {
  now(): Date;
}

/** Stable codes of the errors this package throws. */
export const DB_CODE = {
  unsafeIdentifier: "DB_UNSAFE_IDENTIFIER",
  missingTable: "DB_MISSING_TABLE",
  undeclaredTable: "DB_UNDECLARED_TABLE",
  badVersions: "DB_BAD_VERSIONS",
  unknownVersion: "DB_UNKNOWN_VERSION",
  missingModules: "DB_MISSING_MODULES",
  frozenChanged: "DB_FROZEN_VERSION_CHANGED",
  order: "DB_MODULE_ORDER",
} as const;
export type DbCode = (typeof DB_CODE)[keyof typeof DB_CODE];

/** A refusal of this package: a stable `code`, and the items it concerns (`audit v2`, a table name). */
export class DbError extends Error {
  constructor(
    readonly code: DbCode,
    readonly details: readonly string[] = [],
  ) {
    super(details.length > 0 ? `${code}: ${details.join(", ")}` : code);
    this.name = "DbError";
  }
}
