import { ident } from "./identifiers";
import type { Connect, Connection } from "./port";

/** One step of a product's own migration sequence: its own tables, or a module version from `emitMigration`. */
export interface ProductMigration {
  version: string;
  sql: string;
}

export interface MigrateOptions {
  /** The advisory lock every instance takes: two instances starting together never race. */
  lockKey: number;
  /** The history table (`version text` primary key). Default `schema_migrations`. */
  historyTable?: string;
}

async function pending(connection: Connection, history: string, migrations: readonly ProductMigration[]): Promise<ProductMigration[]> {
  await connection.query(`CREATE TABLE IF NOT EXISTS ${history} (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set(((await connection.query(`SELECT version FROM ${history}`)).rows as { version: string }[]).map((r) => r.version));
  return migrations.filter((m) => !done.has(m.version));
}

async function applyOne(connection: Connection, history: string, migration: ProductMigration): Promise<void> {
  await connection.query("BEGIN");
  try {
    await connection.query(migration.sql);
    await connection.query(`INSERT INTO ${history} (version) VALUES ($1)`, [migration.version]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  }
}

/**
 * The runner for products without one: applies the migrations not applied yet, in order, one transaction each, under an
 * advisory lock. The same behaviour as the hand-written runners it replaces (yomizaka `apps/web/lib/db.ts`).
 * @param connect opens a connection
 * @param migrations the product's whole sequence, in order
 * @param options the lock key and the history table
 * @returns the versions applied by this call
 * @throws the failing migration's error, after its rollback (the ones before it stay applied)
 */
export async function migrate(connect: Connect, migrations: readonly ProductMigration[], options: MigrateOptions): Promise<string[]> {
  const history = ident(options.historyTable ?? "schema_migrations");
  const connection = await connect();
  const applied: string[] = [];
  try {
    await connection.query("SELECT pg_advisory_lock($1)", [options.lockKey]);
    for (const migration of await pending(connection, history, migrations)) {
      await applyOne(connection, history, migration);
      applied.push(migration.version);
    }
  } finally {
    await connection.query("SELECT pg_advisory_unlock($1)", [options.lockKey]).catch(() => undefined);
    await connection.release();
  }
  return applied;
}
