import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adoptMigration,
  assertModules,
  type Connection,
  defineModule,
  emitMigration,
  migrate,
  type ProductMigration,
  queryOf,
  transaction,
} from "../src";
import { assertUpgrade, createTestDatabase, type TestDatabase } from "../src/testing";

/** Against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…): a fresh database per run, dropped after. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;

/** The test's own driver: the package never imports one. */
function connectTo(database?: string) {
  return async (): Promise<Connection> => {
    const url = new URL(process.env.DATABASE_URL!);
    if (database) url.pathname = `/${database}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    return { query: (sql, params) => client.query(sql, params as unknown[]), release: () => client.end() };
  };
}

const audit = defineModule({
  module: "audit",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "entries",
      sql: (c) =>
        `CREATE TABLE ${c.schema}.entry (id bigserial PRIMARY KEY, actor_id uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL, action text NOT NULL);`,
    },
    { version: 2, name: "action index", sql: (c) => `CREATE INDEX entry_action ON ${c.schema}.entry (action);` },
  ],
});
const context = { tables: { owner: "accounts" } };

/** A product's sequence: its own tables, a module embedded, and a product table that references the module's rows. */
const productV1: ProductMigration[] = [
  {
    version: "0001_accounts",
    sql: "CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL);",
  },
  { version: "0002_audit_1", sql: emitMigration(audit, 1, context) },
  {
    version: "0003_reviews",
    sql: "CREATE TABLE reviews (id serial PRIMARY KEY, audit_entry_id bigint REFERENCES audit.entry(id));",
  },
];
const productV2: ProductMigration[] = [
  ...productV1,
  { version: "0004_audit_2", sql: emitMigration(audit, 2, context) },
];

describe.runIf(enabled)("@krizaka/db on PostgreSQL", () => {
  let test: TestDatabase;
  let connect: () => Promise<Connection>;

  beforeAll(async () => {
    test = await createTestDatabase({
      connect: (database) => connectTo(database)(),
      migrate: async (connectNew) => {
        await migrate(connectNew, productV1, { lockKey: 731 });
      },
      prefix: "kzdb",
    });
    connect = connectTo(test.name);
  });
  afterAll(async () => {
    await test?.drop();
  });

  it("builds a fresh database where foreign keys go both ways: module → owner, product → module", async () => {
    await transaction(connect, async (query) => {
      const [account] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ('a@test') RETURNING id");
      const [entry] = await query<{ id: string }>(
        "INSERT INTO audit.entry (actor_id, action) VALUES ($1, 'x') RETURNING id",
        [account!.id],
      );
      await query("INSERT INTO reviews (audit_entry_id) VALUES ($1)", [entry!.id]);
    });
    const connection = await connect();
    expect((await queryOf(connection)("SELECT count(*)::int AS n FROM reviews"))[0]).toEqual({ n: 1 });
    await connection.release();
  });

  it("rolls a transaction back entirely", async () => {
    await expect(
      transaction(connect, async (query) => {
        await query("INSERT INTO audit.entry (action) VALUES ('kept?')");
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const connection = await connect();
    expect(await queryOf(connection)("SELECT * FROM audit.entry WHERE action = 'kept?'")).toEqual([]);
    await connection.release();
  });

  it("applies a sequence once, even when two instances start together", async () => {
    const results = await Promise.all([
      migrate(connect, productV2, { lockKey: 731 }),
      migrate(connect, productV2, { lockKey: 731 }),
    ]);
    expect(results.flat()).toEqual(["0004_audit_2"]);
    const connection = await connect();
    await expect(assertModules(queryOf(connection), [{ schema: audit, context }])).resolves.toBeUndefined();
    await connection.release();
  });

  it("upgrades N-1 → N keeping the rows", async () => {
    const fresh = await createTestDatabase({
      connect: (database) => connectTo(database)(),
      migrate: async () => {},
      prefix: "kzup",
    });
    try {
      const freshConnect = connectTo(fresh.name);
      await assertUpgrade(freshConnect, {
        from: productV1,
        seed: "INSERT INTO accounts (email) VALUES ('kept@test')",
        to: productV2,
        check: async (query) => {
          expect(await query("SELECT email FROM accounts")).toEqual([{ email: "kept@test" }]);
        },
      });
    } finally {
      await fresh.drop();
    }
  });

  it("adopts tables that already exist: markers only, and the boot check passes", async () => {
    const legacy = await createTestDatabase({
      connect: (database) => connectTo(database)(),
      migrate: async () => {},
      prefix: "kzad",
    });
    try {
      const legacyConnect = connectTo(legacy.name);
      await migrate(
        legacyConnect,
        [
          {
            version: "1",
            sql: "CREATE TABLE accounts (id uuid PRIMARY KEY); CREATE SCHEMA audit; CREATE TABLE audit.entry (id bigserial PRIMARY KEY, actor_id uuid, action text); CREATE INDEX entry_action ON audit.entry (action);",
          },
          { version: "2", sql: adoptMigration(audit, 2, context) },
        ],
        { lockKey: 732 },
      );
      const connection = await legacyConnect();
      await expect(assertModules(queryOf(connection), [{ schema: audit, context }])).resolves.toBeUndefined();
      await connection.release();
    } finally {
      await legacy.drop();
    }
  });

  it("creates the marker table once when several modules migrate at the same moment under different lock keys (#241)", async () => {
    // Several packages of one product migrate concurrently on a shared database: `CREATE TABLE IF NOT EXISTS` alone is not atomic
    // in PostgreSQL (23505 on pg_type). The emitted SQL serialises the marker table's creation itself.
    const modules = Array.from({ length: 8 }, (_, i) =>
      defineModule({
        module: `race${i}`,
        tables: [],
        migrations: [{ version: 1, name: "t", sql: (c) => `CREATE TABLE ${c.schema}.t (id int);` }],
      }),
    );
    for (let round = 0; round < 6; round += 1) {
      const fresh = await createTestDatabase({
        connect: (database) => connectTo(database)(),
        migrate: async () => {},
        prefix: "kzrace",
      });
      try {
        const run = (index: number) =>
          migrate(
            connectTo(fresh.name),
            [{ version: `0001_race${index}`, sql: emitMigration(modules[index]!, 1, { tables: {} }) }],
            { lockKey: 9000 + index },
          );
        await Promise.all(modules.map((_, index) => run(index)));
        const connection = await connectTo(fresh.name)();
        expect((await queryOf(connection)("SELECT count(*)::int AS n FROM krizaka_module_versions"))[0]).toEqual({
          n: 8,
        });
        await connection.release();
      } finally {
        await fresh.drop();
      }
    }
  });
});
