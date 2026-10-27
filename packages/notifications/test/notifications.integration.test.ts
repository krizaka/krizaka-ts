import { randomUUID } from "node:crypto";

import { emitMigration, transaction } from "@krizaka/db";
import { createOutbox, dbOutboxStore, outboxSchema } from "@krizaka/outbox";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotifications, dbNotificationStore, type NotificationConfig, notificationsSchema, type Query } from "../src";
import { notificationStoreContract, T0 } from "../src/testkit";

/** The store and the burst cap against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 DATABASE_URL=…), in schemas of their own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);
const schema = `nt_${suffix}`;
const outboxSchemaName = `no_${suffix}`;
const accounts = `nt_${suffix}_account`;

const config: NotificationConfig = {
  retentionDays: 30,
  categories: { messages: { locked: false, defaults: { app: true, push: true, email: true }, burstMax: 5, burstWindowSeconds: 3600 } },
};

describe.runIf(enabled)("notifications: PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async <T>(sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows as T[];
  const connect = async () => pool.connect();
  const newAccount = async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO ${accounts} (id) VALUES ($1)`, [id]);
    return id;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 30 });
    await pool.query(`CREATE TABLE ${accounts} (id uuid PRIMARY KEY)`);
    await pool.query(emitMigration(notificationsSchema, 1, { tables: { owner: accounts }, schema }));
    await pool.query(emitMigration(outboxSchema, 1, { tables: {}, schema: outboxSchemaName }));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE; DROP SCHEMA ${outboxSchemaName} CASCADE; DROP TABLE ${accounts}`);
    await pool.end();
  });

  notificationStoreContract("pg", () => dbNotificationStore(query, schema), newAccount);

  it("the burst cap holds under concurrency: of 40 simultaneous notifications, exactly the cap is delivered and the rest are bell-only", async () => {
    const account = await newAccount();
    const clock = { now: () => T0 };
    const outbox = createOutbox({ clock, settings: { batchSize: 100, leaseSeconds: 60, maxAttempts: 3, backoffSeconds: 30, backoffMaxSeconds: 100, retentionDays: 7 }, storeFor: (q) => dbOutboxStore(q, outboxSchemaName) });
    const notifications = createNotifications({ clock, outbox, config, schema });
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => transaction(connect, (tx) => notifications.notify(tx, { accountId: account, category: "messages", template: "new-message", dedupeKey: `n:${i}` }))));
    expect(results.filter((r) => !r.capped)).toHaveLength(5);
    expect(results.filter((r) => r.capped)).toHaveLength(35);
    const [row] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${outboxSchemaName}.message WHERE topic = 'notifications.live' AND payload->>'accountId' = $1`, [account]);
    expect(row?.n).toBe(5);
    expect(await notifications.unreadCount(query, account)).toBe(40);
  });

  it("a rolled-back transaction leaves neither the item nor the messages", async () => {
    const account = await newAccount();
    const clock = { now: () => T0 };
    const outbox = createOutbox({ clock, settings: { batchSize: 100, leaseSeconds: 60, maxAttempts: 3, backoffSeconds: 30, backoffMaxSeconds: 100, retentionDays: 7 }, storeFor: (q) => dbOutboxStore(q, outboxSchemaName) });
    const notifications = createNotifications({ clock, outbox, config, schema });
    await expect(
      transaction(connect, async (tx) => {
        await notifications.notify(tx, { accountId: account, category: "messages", template: "new-message" });
        throw new Error("the work failed");
      }),
    ).rejects.toThrow("the work failed");
    expect(await notifications.unreadCount(query, account)).toBe(0);
    const [row] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${outboxSchemaName}.message WHERE payload->>'accountId' = $1`, [account]);
    expect(row?.n).toBe(0);
  });
});
