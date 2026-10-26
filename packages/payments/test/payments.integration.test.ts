import { emitMigration, transaction } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adoptPaymentEventsSql, applyOnceInTransaction, dbDiscountStore, dbEventStore, type PaymentEvent, paymentsSchema } from "../src";
import { discountStoreContract, eventStoreContract } from "../src/testkit";

/** The payments tables against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 and a DATABASE_URL), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `pay_${Math.random().toString(36).slice(2, 10)}`;
const legacy = `${schema}_legacy`;
const moved = `${schema}_moved`;
const FACTS = { checkoutRef: "cs_1", paymentRef: "pi_1", invoiceRef: null, amountTotal: 1149, amountDiscount: 0, currency: "cad", metadata: {} };
const paid: PaymentEvent = { id: "evt_paid", type: "payment_paid", kind: "audit", accountId: "a1", customerId: null, ...FACTS };
const T0 = new Date("2026-10-26T12:00:00.000Z");

describe.runIf(enabled)("payments: PostgreSQL", () => {
  let pool: pg.Pool;
  const query = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
  const connect = async () => pool.connect();
  const count = async (table: string) => (await query(`SELECT count(*)::int AS n FROM ${schema}.${table}`))[0]?.n;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    await pool.query(emitMigration(paymentsSchema, 1, { tables: {}, schema }));
    await pool.query(`CREATE TABLE ${schema}.balance (n integer NOT NULL)`);
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE; DROP SCHEMA IF EXISTS ${legacy} CASCADE; DROP SCHEMA IF EXISTS ${moved} CASCADE`);
    await pool.end();
  });

  eventStoreContract("pg", async () => {
    await pool.query(`TRUNCATE ${schema}.event`);
    return dbEventStore(query, { schema, table: "event" });
  });
  discountStoreContract("pg", async () => {
    await pool.query(`TRUNCATE ${schema}.discount`);
    return dbDiscountStore(query, schema);
  });

  it("stamps the receipt time from the injected clock", async () => {
    await pool.query(`TRUNCATE ${schema}.event`);
    await dbEventStore(query, { schema, table: "event" }).markSeen("evt_t", "payment_paid", T0);
    expect(new Date((await query(`SELECT received_at FROM ${schema}.event`))[0]!.received_at as string).toISOString()).toBe(T0.toISOString());
  });

  it("commits the record and the effect together, rolls both back when the handler fails, and a replay changes nothing", async () => {
    await pool.query(`TRUNCATE ${schema}.event, ${schema}.balance`);
    const table = { schema, table: "event" };
    const run = (fail: boolean) =>
      applyOnceInTransaction(
        (work) => transaction(connect, work),
        paid,
        {
          payment_paid: async (_e, tx) => {
            await tx(`INSERT INTO ${schema}.balance VALUES (1)`);
            if (fail) throw new Error("the effect failed");
          },
        },
        { table, clock: { now: () => T0 } },
      );
    await expect(run(true)).rejects.toThrow("the effect failed");
    expect(await count("event")).toBe(0);
    expect(await count("balance")).toBe(0);
    expect(await run(false)).toBe("applied");
    expect(await run(false)).toBe("duplicate");
    expect(await count("balance")).toBe(1);
  });

  it("CONCURRENT REPLAY: the same event delivered by many requests at once is applied exactly once (run in a loop)", async () => {
    for (let round = 0; round < 5; round += 1) {
      await pool.query(`TRUNCATE ${schema}.event, ${schema}.balance`);
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () =>
          applyOnceInTransaction((work) => transaction(connect, work), { ...paid, id: `evt_${round}` }, { payment_paid: async (_e, tx) => void (await tx(`INSERT INTO ${schema}.balance VALUES (1)`)) }, { table: { schema, table: "event" } }),
        ),
      );
      expect(outcomes.filter((o) => o === "applied")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(11);
      expect(await count("balance")).toBe(1);
    }
  });

  it("CONCURRENT TERMS: many checkouts remembering one (coupon, version) keep the first reference", async () => {
    await pool.query(`TRUNCATE ${schema}.discount`);
    const store = dbDiscountStore(query, schema);
    const refs = await Promise.all(Array.from({ length: 10 }, (_, i) => store.remember("c1", 1, "stripe", `co_${i}`)));
    expect(new Set(refs).size).toBe(1);
    expect(await store.find("c1", 1, "stripe")).toBe(refs[0]);
  });

  it("adopts a product's existing payment_events: the rows move, version 1 leaves them, the module reads them", async () => {
    await pool.query(`CREATE SCHEMA ${legacy}; CREATE TABLE ${legacy}.payment_events (id text PRIMARY KEY, type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()); INSERT INTO ${legacy}.payment_events (id, type) VALUES ('evt_old', 'payment_paid')`);
    await pool.query(adoptPaymentEventsSql(legacy, moved));
    await pool.query(emitMigration(paymentsSchema, 1, { tables: {}, schema: moved }));
    const store = dbEventStore(query, { schema: moved, table: "event" });
    expect(await store.markSeen("evt_old", "payment_paid")).toBe(false);
    expect(await store.markSeen("evt_new", "payment_paid")).toBe(true);
    await pool.query(adoptPaymentEventsSql(legacy, moved)); // idempotent: nothing left to move
    expect((await query(`SELECT count(*)::int AS n FROM ${moved}.event`))[0]?.n).toBe(2);
  });
});

describe("payments: the names it checks", () => {
  it("refuses an unsafe schema or table name before any SQL is written (a test that runs without a database)", () => {
    expect(() => dbEventStore(async () => [], { schema: "payments; DROP TABLE x", table: "event" })).toThrow(/DB_UNSAFE_IDENTIFIER/);
    expect(() => dbEventStore(async () => [], { schema: "payments", table: "event; --" })).toThrow(/DB_UNSAFE_IDENTIFIER/);
    expect(() => dbDiscountStore(async () => [], "payments; DROP TABLE x")).toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
