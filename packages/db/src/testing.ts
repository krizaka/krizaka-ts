import { randomBytes } from "node:crypto";

import { ident } from "./identifiers";
import { migrate, type ProductMigration } from "./migrate";
import { compareVersions,type ComposedModule } from "./modules";
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
  /** A short name for the run (`ak`, `yzk`): the database is `<prefix>_it_<random>`. */
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
 * @throws the migration's error, after dropping the database
 */
export async function createTestDatabase(options: TestDatabaseOptions): Promise<TestDatabase> {
  const name = `${ident(options.prefix)}_it_${randomBytes(6).toString("hex")}`;
  await run(await options.connect(), `CREATE DATABASE ${name}`);
  const drop = async () => run(await options.connect(), `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  try {
    await options.migrate(() => options.connect(name));
  } catch (error) {
    await drop();
    throw error;
  }
  return { name, drop };
}

const MARKER = /\('([a-z_][a-z0-9_]*)', (\d+), '([0-9a-f]{64})'\)/g;

/** Where each « module vN » marker first appears in the sequence, with its checksum. */
function markersIn(files: readonly string[]): Map<string, { checksum: string; at: number }> {
  const found = new Map<string, { checksum: string; at: number }>();
  files.forEach((text, at) => {
    for (const [, module, version, checksum] of text.matchAll(MARKER)) {
      const label = `${module} v${version}`;
      if (!found.has(label)) found.set(label, { checksum: checksum!, at });
    }
  });
  return found;
}

/**
 * The product's drift test: every version of every composed module is embedded in the product's sequence, with the SQL the
 * package has today, and a module's first version comes after the first version of each module it requires.
 * @param files the product's migration files, in order (their text)
 * @param modules the modules the product composes
 * @throws DbError `DB_FROZEN_VERSION_CHANGED`, `DB_MISSING_MODULES` or `DB_MODULE_ORDER`
 */
export function assertEmbedded(files: readonly string[], modules: readonly ComposedModule[]): void {
  const found = markersIn(files);
  compareVersions(modules, new Map([...found].map(([label, m]) => [label, m.checksum])));
  const late = modules.flatMap(({ schema }) =>
    schema.requires.filter((required) => (found.get(`${required} v1`)?.at ?? Infinity) > found.get(`${schema.module} v1`)!.at).map((required) => `${schema.module} before ${required}`),
  );
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
