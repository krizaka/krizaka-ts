import { type Connection, emitMigration, migrate, queryOf } from "@krizaka/db";
import { createTestDatabase, type TestDatabase } from "@krizaka/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbTenantKeyStore, memoryKeyService, tenantVault } from "../src/node";
import { dbProviderStore, storageSchema } from "../src/provider-admin";
import { providerStoreContract, tenantKeyStoreContract } from "../src/testkit";

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
      migrate: (connect) =>
        migrate(
          connect,
          [
            { version: "0001_storage_1", sql: emitMigration(storageSchema, 1, { tables: {} }) },
            { version: "0002_storage_2", sql: emitMigration(storageSchema, 2, { tables: {} }) },
          ],
          {
            lockKey: 7402,
          },
        ).then(() => undefined),
      prefix: "kzstorage",
    });
    connection = await connectTo(test.name)();
  });
  afterAll(async () => {
    await connection?.release();
    await test?.drop();
  });
  it("embeds the two tables in the product's database, in their own schema", async () => {
    const rows = await queryOf(connection)<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'storage' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual(["default_provider", "provider", "tenant_key", "tenant_keyring"]);
  });
  providerStoreContract("pg", async () => {
    const query = queryOf(connection);
    await query("TRUNCATE storage.default_provider, storage.provider CASCADE");
    return dbProviderStore(query);
  });
  tenantKeyStoreContract("pg", async () => {
    const query = queryOf(connection);
    await query("TRUNCATE storage.tenant_key, storage.tenant_keyring CASCADE");
    return dbTenantKeyStore(query);
  });

  it("a shred racing with first uses never leaves a key behind, and many first uses make one key", async () => {
    const clients = await Promise.all(Array.from({ length: 6 }, () => connectTo(test.name)()));
    try {
      const kms = memoryKeyService();
      const vaults = clients.map((c) =>
        tenantVault({
          kms,
          keys: dbTenantKeyStore(queryOf(c)),
          clock: { now: () => new Date("2026-10-31T10:00:00Z") },
          audit: async () => {},
          cacheSeconds: 0,
        }),
      );
      for (let round = 0; round < 15; round += 1) {
        const tenant = `race-${round}`;
        const results = await Promise.allSettled([
          ...vaults.slice(1).map((v) => v.seal(tenant, "t/x/f.txt", new Uint8Array([round]))),
          vaults[0]!.shredTenant(tenant),
        ]);
        const left = await queryOf(connection)<{ n: string }>(
          "SELECT count(*) AS n FROM storage.tenant_key WHERE tenant_id = $1",
          [tenant],
        );
        expect(left[0]!.n).toBe("0");
        for (const r of results)
          if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "STORAGE_TENANT_SHREDDED" });
        await expect(vaults[1]!.seal(tenant, "t/x/g.txt", new Uint8Array([1]))).rejects.toMatchObject({
          code: "STORAGE_TENANT_SHREDDED",
        });
      }
      await Promise.all(vaults.map((v) => v.seal("crowd", "t/crowd/f.txt", new Uint8Array([1]))));
      const versions = await queryOf(connection)("SELECT version FROM storage.tenant_key WHERE tenant_id = 'crowd'");
      expect(versions).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((c) => c.release()));
    }
  });
});
