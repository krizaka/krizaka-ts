import { type Connection, emitMigration, migrate, queryOf, transaction } from "@krizaka/db";
import { createTestDatabase, type TestDatabase } from "@krizaka/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditSchema, createAudit, dbAuditStore } from "../src";
import { auditStoreContract } from "../src/testkit";

/** Against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…): a fresh database, the schema embedded as a product would. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;

const connectTo = (database?: string) => async (): Promise<Connection> => {
  const url = new URL(process.env.DATABASE_URL!);
  if (database) url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return { query: (sql, params) => client.query(sql, params as unknown[]), release: () => client.end() };
};

describe.runIf(enabled)("audit on PostgreSQL", () => {
  let test: TestDatabase;
  let connection: Connection;
  const accounts: string[] = [];

  beforeAll(async () => {
    test = await createTestDatabase({
      connect: (database) => connectTo(database)(),
      migrate: (connect) => migrate(connect, [
        { version: "0001_accounts", sql: "CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL)" },
        { version: "0002_audit_1", sql: emitMigration(auditSchema, 1, { tables: { owner: "accounts" } }) },
      ], { lockKey: 7401 }).then(() => undefined),
      prefix: "kzaudit",
    });
    connection = await connectTo(test.name)();
  });
  afterAll(async () => {
    await connection?.release();
    await test?.drop();
  });

  const owner = async (n: number) => {
    while (accounts.length <= n) accounts.push(((await queryOf(connection)<{ id: string }>("INSERT INTO accounts (email) VALUES ('o@test') RETURNING id"))[0]!).id);
    return accounts[n]!;
  };
  auditStoreContract("pg", () => dbAuditStore(queryOf(connection)), owner);

  it("writes nothing when the caller's transaction rolls back", async () => {
    const audit = createAudit({ clock: { now: () => new Date("2026-10-23T12:00:00Z") } });
    await expect(transaction(connectTo(test.name), async (tx) => {
      await audit.record(tx, { actorId: null, actorLabel: "system", action: "rolled.back" });
      throw new Error("abort");
    })).rejects.toThrow("abort");
    expect(await audit.list(queryOf(connection), { actionPrefix: "rolled." })).toEqual([]);
  });

  it("keeps the entry when its actor's account is deleted, with the actor detached", async () => {
    const audit = createAudit({ clock: { now: () => new Date("2026-10-23T12:00:00Z") } });
    const [gone] = await queryOf(connection)<{ id: string }>("INSERT INTO accounts (email) VALUES ('gone@test') RETURNING id");
    await audit.record(queryOf(connection), { actorId: gone!.id, actorLabel: "Gone", action: "account.deleted_later" });
    await queryOf(connection)("DELETE FROM accounts WHERE id = $1", [gone!.id]);
    const [entry] = await audit.list(queryOf(connection), { actionPrefix: "account.deleted_later" });
    expect(entry).toMatchObject({ actorId: null, actorLabel: "Gone" });
  });
});
