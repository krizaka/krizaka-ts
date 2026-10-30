import { describe, expect, it } from "vitest";

import {
  backoffSeconds,
  createOutbox,
  drainOnce,
  memoryOutboxStore,
  OUTBOX_BOUNDS,
  OUTBOX_CODE,
  OUTBOX_DEFAULTS,
  type OutboxMessage,
  type OutboxSettings,
  runWorker,
} from "../src";
import { outboxStoreContract } from "../src/testkit";

const noQuery = async () => [];
const T0 = new Date("2026-10-26T12:00:00.000Z");

function setup(settings: OutboxSettings | (() => OutboxSettings | Promise<OutboxSettings>) = OUTBOX_DEFAULTS) {
  let now = T0;
  const store = memoryOutboxStore();
  const outbox = createOutbox({ clock: { now: () => now }, settings, storeFor: () => store });
  return { outbox, store, at: (seconds: number) => void (now = new Date(T0.valueOf() + seconds * 1000)) };
}

describe("appending", () => {
  it("writes a message with an id, the topic, the type and the payload, due now", async () => {
    const { outbox, store } = setup();
    const { id, appended } = await outbox.append(noQuery, {
      topic: "mail",
      type: "evt.mail.requested.v1",
      payload: { to: "a@b.c" },
    });
    expect(appended).toBe(true);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.rows()).toHaveLength(1);
    expect(store.rows()[0]).toMatchObject({
      id,
      topic: "mail",
      type: "evt.mail.requested.v1",
      payload: { to: "a@b.c" },
    });
  });

  it("is idempotent on a given id: the same fact appended twice is one message", async () => {
    const { outbox, store } = setup();
    const id = "6f1c2b6e-9a0d-4a53-8d7e-3b2d9c0a1f11";
    expect(
      (await outbox.append(noQuery, { id, topic: "mail", type: "evt.mail.requested.v1", payload: 1 })).appended,
    ).toBe(true);
    expect(
      (await outbox.append(noQuery, { id, topic: "mail", type: "evt.mail.requested.v1", payload: 2 })).appended,
    ).toBe(false);
    expect(store.rows()).toHaveLength(1);
  });

  it("refuses a malformed topic, type or id, and a payload that is not JSON", async () => {
    const { outbox } = setup();
    const ok = { topic: "mail", type: "evt.mail.requested.v1", payload: {} };
    await expect(outbox.append(noQuery, { ...ok, topic: "Mail" })).rejects.toMatchObject({
      code: OUTBOX_CODE.badTopic,
    });
    await expect(outbox.append(noQuery, { ...ok, topic: "" })).rejects.toMatchObject({ code: OUTBOX_CODE.badTopic });
    await expect(outbox.append(noQuery, { ...ok, type: "Evt.Bad" })).rejects.toMatchObject({
      code: OUTBOX_CODE.badType,
    });
    await expect(outbox.append(noQuery, { ...ok, id: "not-a-uuid" })).rejects.toMatchObject({
      code: OUTBOX_CODE.badId,
    });
    await expect(outbox.append(noQuery, { ...ok, payload: undefined })).rejects.toMatchObject({
      code: OUTBOX_CODE.badPayload,
    });
    await expect(outbox.append(noQuery, { ...ok, payload: 1n })).rejects.toThrow();
  });

  it("waits for a scheduled instant", async () => {
    const { outbox, at } = setup();
    await outbox.append(noQuery, {
      topic: "mail",
      type: "evt.mail.requested.v1",
      payload: {},
      availableAt: new Date("2026-10-26T13:00:00Z"),
    });
    expect(await outbox.claim(noQuery, { owner: "w" })).toEqual([]);
    at(3600);
    expect(await outbox.claim(noQuery, { owner: "w" })).toHaveLength(1);
  });
});

describe("the settings", () => {
  it("batchSize and leaseSeconds come from them, read at each call", async () => {
    let batchSize = 2;
    const { outbox, at } = setup(() => ({ ...OUTBOX_DEFAULTS, batchSize, leaseSeconds: 10 }));
    for (let i = 0; i < 5; i += 1)
      await outbox.append(noQuery, { topic: "mail", type: "evt.mail.requested.v1", payload: i });
    expect(await outbox.claim(noQuery, { owner: "w" })).toHaveLength(2);
    batchSize = 10;
    expect(await outbox.claim(noQuery, { owner: "w" })).toHaveLength(3);
    at(10);
    expect(await outbox.claim(noQuery, { owner: "w" })).toHaveLength(5); // every lease (10 s) has expired
  });

  it("refuse a value outside its bounds", async () => {
    for (const key of Object.keys(OUTBOX_BOUNDS) as (keyof OutboxSettings)[]) {
      const { outbox } = setup({ ...OUTBOX_DEFAULTS, [key]: OUTBOX_BOUNDS[key][1] + 1 });
      await expect(outbox.claim(noQuery, { owner: "w" }), key).rejects.toMatchObject({ code: OUTBOX_CODE.badSettings });
    }
    const { outbox } = setup({ ...OUTBOX_DEFAULTS, maxAttempts: 2.5 });
    await expect(outbox.claim(noQuery, { owner: "w" })).rejects.toMatchObject({ code: OUTBOX_CODE.badSettings });
  });

  it("the defaults are the ones of the issue: 50, 60, 8, 30 within 1–500, 10–3600, 1–50, 1–3600", () => {
    expect(OUTBOX_DEFAULTS).toMatchObject({ batchSize: 50, leaseSeconds: 60, maxAttempts: 8, backoffSeconds: 30 });
    expect([
      OUTBOX_BOUNDS.batchSize,
      OUTBOX_BOUNDS.leaseSeconds,
      OUTBOX_BOUNDS.maxAttempts,
      OUTBOX_BOUNDS.backoffSeconds,
    ]).toEqual([
      [1, 500],
      [10, 3600],
      [1, 50],
      [1, 3600],
    ]);
  });

  it("the back-off doubles and is capped", () => {
    const s = { backoffSeconds: 30, backoffMaxSeconds: 3600 };
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffSeconds(n, s))).toEqual([
      30, 60, 120, 240, 480, 960, 1920, 3600, 3600,
    ]);
  });
});

describe("delivering", () => {
  const mail = { topic: "mail", type: "evt.mail.requested.v1" };

  it("delivers each message once to a worker that answers, and records it", async () => {
    const { outbox } = setup();
    for (let i = 0; i < 3; i += 1) await outbox.append(noQuery, { ...mail, payload: { i } });
    const seen: unknown[] = [];
    const summary = await drainOnce({
      outbox,
      query: noQuery,
      owner: "w1",
      deliver: async (m) => void seen.push(m.payload),
    });
    expect(summary).toEqual({ claimed: 3, delivered: 3, retried: 0, dead: 0, lost: 0 });
    expect(seen).toHaveLength(3);
    expect(await outbox.stats(noQuery)).toMatchObject({ delivered: 3, pending: 0 });
    expect(
      await drainOnce({
        outbox,
        query: noQuery,
        owner: "w1",
        deliver: async () => {
          throw new Error("never");
        },
      }),
    ).toMatchObject({ claimed: 0 });
  });

  it("retries a failure after a back-off, then the message is dead, with the error kept", async () => {
    const { outbox, store, at } = setup({ ...OUTBOX_DEFAULTS, maxAttempts: 2, backoffSeconds: 30 });
    await outbox.append(noQuery, { ...mail, payload: {} });
    const fail = async () => {
      throw new Error("provider down");
    };
    expect(await drainOnce({ outbox, query: noQuery, owner: "w", deliver: fail })).toMatchObject({ retried: 1 });
    expect(await drainOnce({ outbox, query: noQuery, owner: "w", deliver: fail })).toMatchObject({ claimed: 0 }); // backing off
    at(30);
    expect(await drainOnce({ outbox, query: noQuery, owner: "w", deliver: fail })).toMatchObject({ dead: 1 });
    expect(store.rows()[0]).toMatchObject({ attempts: 2, lastError: "Error: provider down" });
    expect(await outbox.retryDead(noQuery, store.rows()[0]!.id)).toBe(true);
    expect(await drainOnce({ outbox, query: noQuery, owner: "w", deliver: async () => undefined })).toMatchObject({
      delivered: 1,
    });
  });

  it("CRASH: a worker that delivers and dies before `complete` lets the lease expire, and the message is delivered again", async () => {
    const { outbox, at } = setup();
    const { id } = await outbox.append(noQuery, { ...mail, payload: {} });
    const deliveries: string[] = [];
    // worker 1 claims and delivers, then dies: no complete, no fail
    const [first] = await outbox.claim(noQuery, { owner: "w1" });
    deliveries.push(`w1:${first!.id}`);
    expect(await outbox.claim(noQuery, { owner: "w2" })).toEqual([]); // the lease still holds
    at(60); // the default lease (60 s) has expired
    await drainOnce({ outbox, query: noQuery, owner: "w2", deliver: async (m) => void deliveries.push(`w2:${m.id}`) });
    expect(deliveries).toEqual([`w1:${id}`, `w2:${id}`]);
    expect(await outbox.complete(noQuery, id, "w1")).toBe(false);
  });

  it("an idempotent consumer keyed on the message id has one effect for two deliveries", async () => {
    const { outbox, at } = setup();
    await outbox.append(noQuery, { ...mail, payload: { amount: 5 } });
    const applied = new Set<string>();
    let balance = 0;
    const consumer = async (m: OutboxMessage) => {
      if (applied.has(m.id)) return;
      applied.add(m.id);
      balance += (m.payload as { amount: number }).amount;
    };
    const [first] = await outbox.claim(noQuery, { owner: "w1" });
    await consumer(first!); // delivered, then the worker dies before complete
    at(60);
    await drainOnce({ outbox, query: noQuery, owner: "w2", deliver: consumer });
    expect(balance).toBe(5);
    expect(await outbox.stats(noQuery)).toMatchObject({ delivered: 1 });
  });

  it("a worker whose lease was lost cannot overwrite the new holder's outcome", async () => {
    const { outbox, at } = setup();
    const { id } = await outbox.append(noQuery, { ...mail, payload: {} });
    await outbox.claim(noQuery, { owner: "w1" });
    at(60);
    await outbox.claim(noQuery, { owner: "w2" });
    expect(await outbox.fail(noQuery, id, "w1", new Error("late"))).toEqual({ state: "lost" });
    expect(await outbox.complete(noQuery, id, "w2")).toBe(true);
  });

  it("purges the delivered and dead messages after the retention", async () => {
    const { outbox, at } = setup({ ...OUTBOX_DEFAULTS, retentionDays: 7 });
    await outbox.append(noQuery, { ...mail, payload: {} });
    await drainOnce({ outbox, query: noQuery, owner: "w", deliver: async () => undefined });
    at(6 * 24 * 3600);
    expect(await outbox.purge(noQuery)).toBe(0);
    at(8 * 24 * 3600);
    expect(await outbox.purge(noQuery)).toBe(1);
  });
});

describe("the worker loop", () => {
  it("drains, sleeps when idle through the sleep the product passes (it has no timer of its own), and stops when aborted", async () => {
    const { outbox } = setup();
    await outbox.append(noQuery, { topic: "mail", type: "evt.mail.requested.v1", payload: {} });
    const controller = new AbortController();
    const sleeps: number[] = [];
    const seen: string[] = [];
    await runWorker({
      outbox,
      query: noQuery,
      owner: "w",
      deliver: async (m) => void seen.push(m.id),
      idleSeconds: 7,
      signal: controller.signal,
      sleep: async (seconds) => {
        sleeps.push(seconds);
        if (sleeps.length === 2) controller.abort();
      },
    });
    expect(seen).toHaveLength(1);
    expect(sleeps).toEqual([7, 7]);
  });

  it("goes on after a round that threw, telling onError", async () => {
    const outbox = createOutbox({
      clock: { now: () => T0 },
      settings: OUTBOX_DEFAULTS,
      storeFor: () => ({
        ...memoryOutboxStore(),
        claim: async () => {
          throw new Error("unreachable");
        },
      }),
    });
    const controller = new AbortController();
    const heard: string[] = [];
    await runWorker({
      outbox,
      query: noQuery,
      owner: "w",
      deliver: async () => undefined,
      signal: controller.signal,
      onError: (e) => void heard.push(String(e)),
      sleep: async () => controller.abort(),
    });
    expect(heard).toEqual(["Error: unreachable"]);
  });
});

describe("the memory store", () => {
  outboxStoreContract("memory", () => memoryOutboxStore());
});
