import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbSessionStore, sessionsSchema } from "../src";
import { sessionStoreContract } from "../src/testkit";

/** The session store against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `sess_${Math.random().toString(36).slice(2, 10)}`;

describe.runIf(enabled)("sessions: PostgreSQL", () => {
  let client: pg.Client;
  const query = async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await client.query("CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'ACTIVE')");
    await client.query(sessionsSchema.migrations[0]!.sql({ schema: "public", tables: { accounts: "accounts" } }));
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  const accounts = new Map<number, string>();
  const store = () => dbSessionStore<{ id: string }>(query, { columns: ["id"], toAccount: (row) => ({ id: String(row.id) }), active: { column: "status", equals: "ACTIVE" } });

  sessionStoreContract("pg", () => ({
    store: store(),
    account: async (n) => {
      if (!accounts.has(n)) accounts.set(n, (await client.query("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`s-${n}-${Math.random().toString(36).slice(2)}@test`])).rows[0].id);
      return accounts.get(n)!;
    },
    suspend: async (id) => void (await client.query("UPDATE accounts SET status = 'SUSPENDED' WHERE id = $1", [id])),
  }));

  it("deleting an account deletes its sessions", async () => {
    const accountId = (await client.query("INSERT INTO accounts (email) VALUES ('gone@test') RETURNING id")).rows[0].id as string;
    const s = store();
    await s.insert({ accountId, tokenHash: "gone-hash", createdAt: new Date("2026-10-26T12:00:00Z"), expiresAt: new Date("2026-10-27T12:00:00Z"), ip: null, userAgent: null });
    await client.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    expect(await s.find("gone-hash", new Date("2026-10-26T13:00:00Z"))).toBeNull();
    expect((await client.query("SELECT count(*)::int AS n FROM sessions WHERE token_hash = 'gone-hash'")).rows[0].n).toBe(0);
  });
});

describe("sessions: the table they need", () => {
  it("is the one the PostgreSQL store reads and writes (a test that runs without a database)", () => {
    const sql = sessionsSchema.migrations[0]!.sql({ schema: "public", tables: { accounts: "accounts" } });
    expect(sql).toContain("token_hash   text NOT NULL UNIQUE");
    expect(sql).toContain("expires_at   timestamptz NOT NULL");
  });
});
