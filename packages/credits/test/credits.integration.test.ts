import { randomUUID } from "node:crypto";

import { emitMigration, transaction } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCredits, CREDITS_DEFAULTS, creditsSchema, type OutboxPort, type Query } from "../src";
import { creditsLedgerContract, type LedgerHarness, T0 } from "../src/testkit";

/** The ledger against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 and a DATABASE_URL), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `cr_${Math.random().toString(36).slice(2, 10)}`;
const DAY = 86_400_000;
const accounts = `${schema}_account`;

describe.runIf(enabled)("credits: PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async <T>(sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows as T[];
  const connect = async () => pool.connect();
  let now = T0;
  const announced: ReturnType<LedgerHarness["announced"]> = [];
  const seen = new Set<string>();
  const outbox: OutboxPort = {
    async append(_tx, m) {
      const id = m.id ?? randomUUID();
      const appended = !seen.has(id);
      seen.add(id);
      if (appended) announced.push({ type: m.type, id, payload: m.payload as Record<string, unknown> });
      return { id, appended };
    },
  };
  const credits = () => createCredits({ clock: { now: () => now }, settings: CREDITS_DEFAULTS, schema, outbox });
  const newAccount = async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO ${accounts} (id) VALUES ($1)`, [id]);
    return id;
  };
  const grantTo = (accountId: string, over: Partial<Parameters<ReturnType<typeof credits>["grant"]>[1]> = {}) =>
    credits().grant(query, { accountId, amount: 5, expiresAt: new Date(T0.valueOf() + 30 * DAY), onExhausted: "stop", source: "coupon:it", idempotencyKey: randomUUID(), ...over });
  const inTx = <T>(work: (tx: Query) => Promise<T>) => transaction(connect, work);
  const settle = <T>(promises: Promise<T>[]) => Promise.allSettled(promises);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 30 });
    await pool.query(`CREATE TABLE ${accounts} (id uuid PRIMARY KEY)`);
    await pool.query(emitMigration(creditsSchema, 1, { tables: { owner: accounts }, schema }));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE; DROP TABLE ${accounts}`);
    await pool.end();
  });

  creditsLedgerContract("pg", async () => {
    now = T0;
    announced.length = 0;
    seen.clear();
    // keys are unique per ledger: an empty ledger for each scenario (TRUNCATE fires no row trigger)
    await pool.query(`TRUNCATE ${schema}.entry, ${schema}.hold, ${schema}."grant"`);
    return { credits: credits(), tx: query, setNow: (d) => void (now = d), newAccount, announced: () => announced };
  });

  it("THE LAST CREDIT: concurrent consumers (own transactions, own keys) never go negative and exactly one gets it (run in a loop)", async () => {
    for (let round = 0; round < 10; round += 1) {
      now = T0;
      const a = await newAccount();
      await grantTo(a, { amount: 1 });
      const results = await settle(Array.from({ length: 20 }, (_, i) => inTx((tx) => credits().consume(tx, { accountId: a, amount: 1, reason: "audit", idempotencyKey: `last-${round}-${i}` }))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("CREDITS_EXHAUSTED");
      expect((await credits().balance(query, a)).total).toBe(0);
      const [row] = await query<{ least: string }>(`SELECT COALESCE(MIN(s), 0) AS least FROM (SELECT SUM(amount) AS s FROM ${schema}.entry WHERE account_id = $1 GROUP BY grant_id) t`, [a]);
      expect(Number(row?.least)).toBe(0);
    }
  });

  it("ONE KEY, MANY REQUESTS: the same idempotency key sent at once spends once", async () => {
    for (let round = 0; round < 10; round += 1) {
      const a = await newAccount();
      await grantTo(a, { amount: 5 });
      const results = await Promise.all(Array.from({ length: 15 }, () => inTx((tx) => credits().consume(tx, { accountId: a, amount: 2, reason: "audit", idempotencyKey: `same-${round}` }))));
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(results.map((r) => JSON.stringify(r.draws))).size).toBe(1);
      expect((await credits().balance(query, a)).total).toBe(3);
    }
  });

  it("THE CAP UNDER LOAD: twelve concurrent requests against a cap of three per day give exactly three", async () => {
    for (let round = 0; round < 5; round += 1) {
      const a = await newAccount();
      await grantTo(a, { amount: 50, capPerDay: 3 });
      const results = await settle(Array.from({ length: 12 }, (_, i) => inTx((tx) => credits().consume(tx, { accountId: a, amount: 1, reason: "audit", idempotencyKey: `cap-${round}-${i}` }))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      for (const r of results) if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("CREDITS_CAP_DAY");
    }
  });

  it("HOLDS UNDER LOAD: ten concurrent holds of one credit on five credits give five", async () => {
    const a = await newAccount();
    await grantTo(a, { amount: 5 });
    const results = await settle(Array.from({ length: 10 }, (_, i) => inTx((tx) => credits().hold(tx, { accountId: a, amount: 1, idempotencyKey: `hold-${i}` }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await credits().balance(query, a)).toMatchObject({ total: 5, held: 5, available: 0 });
  });

  it("a refusal inside a transaction rolls the unit of work back with it", async () => {
    const a = await newAccount();
    await expect(
      inTx(async (tx) => {
        await grantTo(a, { amount: 1 });
        await credits().grant(tx, { accountId: a, amount: 2, expiresAt: new Date(T0.valueOf() + DAY), onExhausted: "stop", source: "s", idempotencyKey: "in-tx" });
        await credits().consume(tx, { accountId: a, amount: 5, reason: "audit", idempotencyKey: "too-much" });
      }),
    ).rejects.toMatchObject({ code: "CREDITS_EXHAUSTED" });
    expect((await credits().balance(query, a)).total).toBe(1);
    expect(await query(`SELECT 1 FROM ${schema}.entry WHERE idempotency_key = 'grant.in-tx:0'`)).toHaveLength(0);
  });

  it("the ledger is append-only: an UPDATE or a DELETE of a line is refused by the database", async () => {
    const a = await newAccount();
    await grantTo(a);
    await expect(pool.query(`UPDATE ${schema}.entry SET amount = 99 WHERE account_id = $1`, [a])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM ${schema}.entry WHERE account_id = $1`, [a])).rejects.toThrow(/append-only/);
    expect((await credits().balance(query, a)).total).toBe(5);
  });

  it("the database refuses what the rules refuse: a purchased pot that lapses, a zero line that is not an expiry, a duplicate key", async () => {
    const a = await newAccount();
    const g = await grantTo(a);
    await expect(pool.query(`INSERT INTO ${schema}."grant" (id, account_id, bucket, amount, expires_at, on_exhausted, source, created_at) VALUES ($1, $2, 'purchased', 1, now(), 'stop', 's', now())`, [randomUUID(), a])).rejects.toThrow();
    const line = (key: string, amount: number, type = "ADJUSTMENT") => pool.query(`INSERT INTO ${schema}.entry (id, account_id, grant_id, type, amount, reason, operation, idempotency_key, at) VALUES ($1, $2, $3, $4, $5, 'r', 'o', $6, now())`, [randomUUID(), a, g.grantId, type, amount, key]);
    await expect(line("zero:0", 0)).rejects.toThrow();
    await line("zero:1", 0, "EXPIRY");
    await line("dup:0", 1);
    await expect(line("dup:0", 1)).rejects.toThrow();
  });

  it("an owner with credits cannot be deleted (it is an accounting record: anonymise it)", async () => {
    const a = await newAccount();
    await grantTo(a);
    await expect(pool.query(`DELETE FROM ${accounts} WHERE id = $1`, [a])).rejects.toThrow();
  });

  it("the sweep finds only granted pots past their date that still hold credits", async () => {
    now = T0;
    const a = await newAccount();
    await grantTo(a, { amount: 3, expiresAt: new Date(T0.valueOf() + DAY) });
    now = new Date(T0.valueOf() + 2 * DAY);
    expect(await inTx((tx) => credits().expireDue(tx, { limit: 1000 }))).toBeGreaterThanOrEqual(1);
    expect(await inTx((tx) => credits().expireDue(tx, { limit: 1000 }))).toBe(0);
    now = T0;
  });
});

describe("credits: the names it checks", () => {
  it("refuses an unsafe schema name before any SQL is written (a test that runs without a database)", async () => {
    const credits = createCredits({ clock: { now: () => T0 }, settings: CREDITS_DEFAULTS, schema: "credits; DROP TABLE x" });
    await expect(credits.balance((async () => []) as unknown as Query, "a")).rejects.toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
