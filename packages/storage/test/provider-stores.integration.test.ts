import { type Connection, emitMigration, migrate, queryOf } from "@krizaka/db";
import { createTestDatabase, type TestDatabase } from "@krizaka/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbProviderStore, storageSchema } from "../src/provider-admin";
import { providerStoreContract } from "../src/testkit";

/** Against a real PostgreSQL (CI's service; locally STORAGE_DB_IT=1 DATABASE_URL=…): a fresh database, the schema embedded as a product would. */
const enabled = (process.env.STORAGE_DB_IT === "1" || process.env.ORGANIZE_DB_IT === "1") && !!process.env.DATABASE_URL;

const connectTo = (database?: string) => async (): Promise<Connection> => {
  const url = new URL(process.env.DATABASE_URL!);
  if (database) url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return { query: (sql, params) => client.query(sql, params as unknown[]), release: () => client.end() };
};

describe.runIf(enabled)("storage providers on PostgreSQL", () => {
  let test: TestDatabase;
  let connection: Connection;
  beforeAll(async () => {
    test = await createTestDatabase({
      connect: (database) => connectTo(database)(),
      migrate: (connect) => migrate(connect, [{ version: "0001_storage_1", sql: emitMigration(storageSchema, 1, { tables: {} }) }], { lockKey: 7402 }).then(() => undefined),
      prefix: "kzstorage",
    });
    connection = await connectTo(test.name)();
  });
  afterAll(async () => {
    await connection?.release();
    await test?.drop();
  });
  it("embeds the two tables in the product's database, in their own schema", async () => {
    const rows = await queryOf(connection)<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'storage' ORDER BY table_name");
    expect(rows.map((r) => r.table_name)).toEqual(["default_provider", "provider"]);
  });
  providerStoreContract("pg", async () => {
    const query = queryOf(connection);
    await query("TRUNCATE storage.default_provider, storage.provider CASCADE");
    return dbProviderStore(query);
  });
});
