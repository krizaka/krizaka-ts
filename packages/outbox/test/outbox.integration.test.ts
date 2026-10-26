import { emitMigration, transaction } from "@krizaka/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backoffSeconds, consumeOnce, createOutbox, dbOutboxStore, drainOnce, OUTBOX_DEFAULTS, outboxSchema } from "../src";
import { outboxStoreContract } from "../src/testkit";

/** The outbox against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in a schema of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const schema = `ob_${Math.random().toString(36).slice(2, 10)}`;
const T0 = new Date("2026-10-26T12:00:00.000Z");
const mail = { topic: "mail", type: "evt.mail.requested.v1" };

describe.runIf(enabled)("outbox: PostgreSQL", () => {
  let pool: pg.Pool;
  const query = async (sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows;
  let now = T0;
  const outbox = () => createOutbox({ clock: { now: () => now }, settings: { ...OUTBOX_DEFAULTS, batchSize: 7 }, schema });
  const reset = async () => {
    await pool.query(`TRUNCATE ${schema}.message, ${schema}.processed`);
    now = T0;
  };
  const at = (seconds: number) => void (now = new Date(T0.valueOf() + seconds * 1000));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    await pool.query(emitMigration(outboxSchema, 1, { tables: {}, schema }));
    await pool.query(`CREATE TABLE ${schema}.balance (account text PRIMARY KEY, amount integer NOT NULL)`);
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  outboxStoreContract("pg", async () => {
    await reset();
    return dbOutboxStore(query, schema);
  });

  it("append inside a rolled-back transaction leaves nothing, and inside a committed one the message", async () => {
    await reset();
    const connect = async () => pool.connect();
    await expect(
      transaction(connect, async (tx) => {
        await outbox().append(tx, { ...mail, payload: { n: 1 } });
        throw new Error("the use case failed");
      }),
    ).rejects.toThrow("the use case failed");
    expect((await query(`SELECT count(*)::int AS n FROM ${schema}.message`))[0]?.n).toBe(0);
    await transaction(connect, async (tx) => void (await outbox().append(tx, { ...mail, payload: { n: 2 } })));
    expect((await query(`SELECT count(*)::int AS n FROM ${schema}.message`))[0]?.n).toBe(1);
  });

  it("EXCLUSIVE CLAIM: concurrent claimers never hold the same message during a valid lease (run in a loop)", async () => {
    for (let round = 0; round < 10; round += 1) {
      await reset();
      const ob = outbox();
      await Promise.all(Array.from({ length: 60 }, (_, i) => ob.append(query, { ...mail, payload: { i } })));
      const claimers = Array.from({ length: 6 }, (_, w) => async () => {
        const mine: string[] = [];
        for (;;) {
          const batch = await ob.claim(query, { owner: `worker-${w}`, leaseSeconds: 600 });
          if (batch.length === 0) return mine;
          mine.push(...batch.map((m) => m.id));
        }
      });
      const taken = (await Promise.all(claimers.map((run) => run()))).flat();
      expect(taken, `round ${round}`).toHaveLength(60);
      expect(new Set(taken).size, `round ${round}`).toBe(60);
    }
  });

  it("CRASH: a worker delivers and dies before `complete`, the lease expires, and another worker claims and delivers the message again", async () => {
    await reset();
    const ob = outbox();
    const { id } = await ob.append(query, { ...mail, payload: {} });
    const [first] = await ob.claim(query, { owner: "w1" });
    expect(first?.id).toBe(id);
    expect(await ob.claim(query, { owner: "w2" })).toEqual([]);
    at(60);
    const delivered: string[] = [];
    expect(await drainOnce({ outbox: ob, query, owner: "w2", deliver: async (m) => void delivered.push(m.id) })).toMatchObject({ delivered: 1 });
    expect(delivered).toEqual([id]);
    expect(await ob.complete(query, id, "w1")).toBe(false);
  });

  it("IDEMPOTENT CONSUMER: two deliveries of one message have one effect, and a failing effect leaves no marker", async () => {
    await reset();
    const connect = async () => pool.connect();
    const credit = (tx: typeof query) => async () => void (await tx(`INSERT INTO ${schema}.balance (account, amount) VALUES ('a', 5) ON CONFLICT (account) DO UPDATE SET amount = ${schema}.balance.amount + 5`));
    const id = "6f1c2b6e-9a0d-4a53-8d7e-3b2d9c0a1f11";
    const outcomes: string[] = [];
    for (let delivery = 0; delivery < 2; delivery += 1) {
      outcomes.push(await transaction(connect, (tx) => consumeOnce(tx, "credits", id, T0, credit(tx), schema)));
    }
    expect(outcomes).toEqual(["applied", "duplicate"]);
    expect((await query(`SELECT amount FROM ${schema}.balance WHERE account = 'a'`))[0]?.amount).toBe(5);
    // another consumer of the same message applies it for itself
    expect(await transaction(connect, (tx) => consumeOnce(tx, "audit", id, T0, async () => undefined, schema))).toBe("applied");
    // an effect that fails rolls its marker back: the redelivery applies it
    const other = "0b9d7c3e-1f2a-4c55-9a1e-5d2f7a8b9c10";
    await expect(transaction(connect, (tx) => consumeOnce(tx, "credits", other, T0, async () => { throw new Error("effect failed"); }, schema))).rejects.toThrow("effect failed");
    expect(await transaction(connect, (tx) => consumeOnce(tx, "credits", other, T0, async () => undefined, schema))).toBe("applied");
  });

  it("the back-off written by the database is the pure back-off, for every attempt up to the cap", async () => {
    await reset();
    const store = dbOutboxStore(query, schema);
    const rules = { maxAttempts: 50, backoffSeconds: 30, backoffMaxSeconds: 3600 };
    const id = "11111111-2222-4333-8444-555555555555";
    await store.append({ id, ...{ topic: "mail", type: "evt.mail.requested.v1" }, payload: {}, createdAt: T0, availableAt: T0 });
    let clock = T0;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const [claimed] = await store.claim({ owner: "w", limit: 1, leaseSeconds: 60, maxAttempts: 50, now: clock });
      expect(claimed?.attempts).toBe(attempt);
      const outcome = await store.fail(id, "w", "x", { now: clock, ...rules });
      if (outcome.state !== "retry") throw new Error("expected a retry");
      expect((outcome.availableAt.valueOf() - clock.valueOf()) / 1000, `attempt ${attempt}`).toBe(backoffSeconds(attempt, rules));
      clock = outcome.availableAt;
    }
  });

  it("keeps the payload as JSON, the envelope's time as occurredAt, and refuses an unsafe schema name", async () => {
    await reset();
    const ob = outbox();
    await ob.append(query, { ...mail, payload: { nested: { list: [1, "two", null], ok: true } } });
    const [m] = await ob.claim(query, { owner: "w" });
    expect(m?.payload).toEqual({ nested: { list: [1, "two", null], ok: true } });
    expect(m?.occurredAt.toISOString()).toBe(T0.toISOString());
    expect(() => createOutbox({ clock: { now: () => T0 }, settings: OUTBOX_DEFAULTS, schema: "outbox; DROP TABLE x" })).toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
