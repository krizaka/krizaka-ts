import { randomBytes } from "node:crypto";

import { rethrowAfter } from "./cleanup";
import { ident } from "./identifiers";
import { migrate, type ProductMigration } from "./migrate";
import { adoptMigration, type ComposedModule, emitMigration } from "./modules";
import { type Connect, type Connection, DB_CODE, DbError, type Query } from "./port";
import { queryOf, transaction } from "./transaction";

/** A database made for one test run; `drop` removes it. */
export interface TestDatabase {
  name: string;
  drop(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** Opens a connection: to the server's default database without a name, or to the named one. The test passes its own driver. */
  connect: (database?: string) => Promise<Connection>;
  /** Builds the schema of the new database: the product's whole sequence, embedded module versions included. */
  migrate: (connect: Connect) => Promise<void>;
  /** A short name for the run (`ak`, `yzk`), at most 47 characters: the database is `<prefix>_it_<12 hex>`, within PostgreSQL's 63. */
  prefix: string;
}

async function run(connection: Connection, sql: string): Promise<void> {
  try {
    await connection.query(sql);
  } finally {
    await connection.release();
  }
}

/**
 * Creates a fresh database on the server the tests point at (CI's service, or a local one), migrates it, and hands back a
 * way to drop it. No driver and no container here: both are the caller's.
 * @returns the database's name and its `drop`
 * @throws the migration's error, after dropping the database (an `AggregateError`, the migration's first, if the drop fails too);
 *   `DB_UNSAFE_IDENTIFIER` for a prefix that is not an identifier or is longer than 47 characters, before any SQL
 */
export async function createTestDatabase(options: TestDatabaseOptions): Promise<TestDatabase> {
  // A longer name would be truncated by PostgreSQL to 63 bytes, cutting the random suffix: runs would collide.
  if (options.prefix.length > 47) throw new DbError(DB_CODE.unsafeIdentifier, [`${options.prefix}: a test database prefix has at most 47 characters`]);
  const name = ident(`${ident(options.prefix)}_it_${randomBytes(6).toString("hex")}`);
  await run(await options.connect(), `CREATE DATABASE ${name}`);
  const drop = async () => run(await options.connect(), `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  try {
    await options.migrate(() => options.connect(name));
  } catch (error) {
    await rethrowAfter(error, drop);
  }
  return { name, drop };
}

/** What `endPool` needs of a `pg.Pool`, said structurally: the package imports no driver. */
export interface ClosableStream {
  destroyed: boolean;
  once(event: "close", listener: () => void): unknown;
}

export interface EndablePool {
  end(): Promise<void>;
  /** `pg.Pool`'s connected clients (private in its typings, hence read structurally). */
  _clients?: { connection?: { stream?: ClosableStream } }[];
}

/**
 * Ends a `pg` pool and waits until its sockets are really closed. `pool.end()` resolves once every client is asked to end,
 * before the server has closed its side: a `DROP DATABASE … WITH (FORCE)` right after kills a backend that is still there,
 * the idle client reads « terminating connection due to administrator command » (57P01) and the pool raises an uncaught
 * error (the flake of akinaza#518 and yomizaka's integration tests). Call it in a test's teardown, before the drop.
 * @param pool a `pg.Pool` (or anything with `end()` and, as `pg` has, its `_clients`)
 */
export async function endPool(pool: EndablePool): Promise<void> {
  const clients = pool._clients ?? [];
  const closed = clients.flatMap(({ connection }) => {
    const stream = connection?.stream;
    return stream && !stream.destroyed ? [new Promise<void>((resolve) => void stream.once("close", () => resolve()))] : [];
  });
  await pool.end();
  await Promise.all(closed);
}

const MARKER = /\('([a-z_][a-z0-9_]*)', (\d+), '([0-9a-f]{64})'\)/g;

/** The text as the drift test compares it: whitespace collapsed, drizzle's statement breakpoints ignored. */
const normalize = (text: string) => text.replace(/-->\s*statement-breakpoint/g, " ").replace(/\s+/g, " ").trim();

/** Where version `version` of a module is in the sequence: its emitted block, or an adoption block that covers it. -1 when absent. */
function positionOf(text: string, module: ComposedModule, version: number): number {
  const emitted = text.indexOf(normalize(emitMigration(module.schema, version, module.context)));
  if (emitted >= 0) return emitted;
  for (let upTo = version; upTo <= module.schema.migrations.length; upTo++) {
    const adopted = text.indexOf(normalize(adoptMigration(module.schema, upTo, module.context)));
    if (adopted >= 0) return adopted;
  }
  return -1;
}

/** Each « module vN » that has a marker somewhere (a marker without its exact block means edited or deleted SQL). */
const markedVersions = (text: string) => new Set([...text.matchAll(MARKER)].map(([, module, version]) => `${module} v${version}`));

/**
 * The product's drift test. Every version of every composed module is in the product's sequence **as `emitMigration` (or
 * `adoptMigration`) writes it today**: the same SQL text, whitespace aside, not only its marker. A module's first version comes
 * after the first version of each module it requires, counted across files and within one file.
 * @param files the product's migration files, in order (their text)
 * @param modules the modules the product composes
 * @throws DbError `DB_FROZEN_VERSION_CHANGED` (a marker whose SQL differs), `DB_MISSING_MODULES` or `DB_MODULE_ORDER`
 */
export function assertEmbedded(files: readonly string[], modules: readonly ComposedModule[]): void {
  const text = normalize(files.join("\n"));
  const marked = markedVersions(text);
  const first = new Map<string, number>();
  const changed: string[] = [];
  const missing: string[] = [];
  for (const module of modules) {
    for (const { version } of module.schema.migrations) {
      const label = `${module.schema.module} v${version}`;
      const at = positionOf(text, module, version);
      if (at < 0) (marked.has(label) ? changed : missing).push(label);
      else if (version === 1) first.set(module.schema.module, at);
    }
  }
  if (changed.length > 0) throw new DbError(DB_CODE.frozenChanged, changed);
  if (missing.length > 0) throw new DbError(DB_CODE.missingModules, missing);
  const late = modules.flatMap(({ schema }) => schema.requires.filter((required) => (first.get(required) ?? Infinity) > first.get(schema.module)!).map((required) => `${schema.module} before ${required}`));
  if (late.length > 0) throw new DbError(DB_CODE.order, late);
}

export interface UpgradeCase {
  /** The sequence as the previous release had it. */
  from: readonly ProductMigration[];
  /** Rows written between the two releases (SQL). */
  seed: string;
  /** The sequence of this release (it starts with `from`). */
  to: readonly ProductMigration[];
  /** What must still hold after the upgrade. */
  check: (query: Query) => Promise<void>;
  /** The advisory lock key. Default 7300. */
  lockKey?: number;
}

/**
 * Applies the previous release's sequence, writes rows, applies this release's, then checks: an upgrade keeps the data.
 * @param connect opens a connection to an empty test database
 * @param upgrade the two sequences, the rows and the check
 */
export async function assertUpgrade(connect: Connect, upgrade: UpgradeCase): Promise<void> {
  const options = { lockKey: upgrade.lockKey ?? 7300 };
  await migrate(connect, upgrade.from, options);
  await transaction(connect, async (query) => { await query(upgrade.seed); });
  await migrate(connect, upgrade.to, options);
  const connection = await connect();
  try {
    await upgrade.check(queryOf(connection));
  } finally {
    await connection.release();
  }
}
