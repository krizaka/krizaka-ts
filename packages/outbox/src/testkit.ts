import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { FAIL_STATE, type OutboxStore } from "./port";

const T0 = new Date("2026-10-26T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.valueOf() + seconds * 1000);
const RULES = { maxAttempts: 3, backoffSeconds: 30, backoffMaxSeconds: 100 };
const claimFor = (
  store: OutboxStore,
  owner: string,
  seconds: number,
  over: { topic?: string; limit?: number; lease?: number } = {},
) =>
  store.claim({
    owner,
    limit: over.limit ?? 10,
    leaseSeconds: over.lease ?? 60,
    maxAttempts: RULES.maxAttempts,
    now: at(seconds),
    ...(over.topic === undefined ? {} : { topic: over.topic }),
  });
const put = (store: OutboxStore, over: { id?: string; topic?: string; availableAt?: Date; payload?: unknown } = {}) => {
  const id = over.id ?? randomUUID();
  return store
    .append({
      id,
      topic: over.topic ?? "mail",
      type: "evt.mail.requested.v1",
      payload: over.payload ?? { to: "a@b.c" },
      createdAt: T0,
      availableAt: over.availableAt ?? T0,
    })
    .then(() => id);
};

/** What every `OutboxStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store. */
export function outboxStoreContract(name: string, make: () => OutboxStore | Promise<OutboxStore>) {
  it(`${name}: appends a message once, whatever the number of appends of its id`, async () => {
    const store = await make();
    const id = randomUUID();
    expect(
      await store.append({
        id,
        topic: "mail",
        type: "evt.mail.requested.v1",
        payload: { n: 1 },
        createdAt: T0,
        availableAt: T0,
      }),
    ).toBe(true);
    expect(
      await store.append({
        id,
        topic: "mail",
        type: "evt.mail.requested.v1",
        payload: { n: 2 },
        createdAt: T0,
        availableAt: T0,
      }),
    ).toBe(false);
    const [only, ...rest] = await claimFor(store, "w1", 0);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id, topic: "mail", type: "evt.mail.requested.v1", payload: { n: 1 }, attempts: 1 });
    expect(only!.occurredAt.toISOString()).toBe(T0.toISOString());
  });

  it(`${name}: holds a claimed message for its lease and gives it to nobody else`, async () => {
    const store = await make();
    await put(store);
    expect(await claimFor(store, "w1", 0)).toHaveLength(1);
    expect(await claimFor(store, "w2", 30)).toEqual([]);
    expect(await claimFor(store, "w2", 59)).toEqual([]);
  });

  it(`${name}: delivers again after a crash: the lease expires without complete, and the message is claimed again`, async () => {
    const store = await make();
    const id = await put(store);
    expect((await claimFor(store, "w1", 0))[0]).toMatchObject({ id, attempts: 1 });
    // w1 delivered, then died before `complete`
    expect((await claimFor(store, "w2", 60))[0]).toMatchObject({ id, attempts: 2 });
    expect(await store.complete(id, "w1", at(61))).toBe(false); // the dead worker's late answer is refused
    expect(await store.complete(id, "w2", at(61))).toBe(true);
  });

  it(`${name}: completes once, for the holder of the lease only`, async () => {
    const store = await make();
    const id = await put(store);
    await claimFor(store, "w1", 0);
    expect(await store.complete(id, "intruder", at(1))).toBe(false);
    expect(await store.complete(id, "w1", at(1))).toBe(true);
    expect(await store.complete(id, "w1", at(2))).toBe(false);
    expect(await claimFor(store, "w1", 1000)).toEqual([]);
  });

  it(`${name}: backs off after a failure, doubling and capped, then goes dead after the last attempt`, async () => {
    const store = await make();
    const id = await put(store);
    await claimFor(store, "w", 0);
    expect(await store.fail(id, "w", "boom", { now: at(1), ...RULES })).toEqual({
      state: "retry",
      availableAt: at(31),
    }); // 30 s
    expect(await claimFor(store, "w", 30)).toEqual([]);
    expect((await claimFor(store, "w", 31))[0]).toMatchObject({ id, attempts: 2 });
    expect(await store.fail(id, "w", "boom", { now: at(40), ...RULES })).toEqual({
      state: "retry",
      availableAt: at(100),
    }); // 60 s
    expect((await claimFor(store, "w", 100))[0]).toMatchObject({ id, attempts: 3 });
    expect(await store.fail(id, "w", "boom", { now: at(110), ...RULES })).toEqual({ state: "dead" });
    expect(await claimFor(store, "w", 100_000)).toEqual([]);
    expect(await store.stats(at(200))).toMatchObject({ dead: 1, pending: 0, leased: 0 });
  });

  it(`${name}: caps the back-off`, async () => {
    const store = await make();
    const id = await put(store);
    const rules = { maxAttempts: 10, backoffSeconds: 30, backoffMaxSeconds: 100 };
    let clock = 0;
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const [m] = await store.claim({ owner: "w", limit: 1, leaseSeconds: 60, maxAttempts: 10, now: at(clock) });
      expect(m?.id).toBe(id);
      const outcome = await store.fail(id, "w", "boom", { now: at(clock), ...rules });
      if (outcome.state !== FAIL_STATE.retry) throw new Error("expected a retry");
      waits.push((outcome.availableAt.valueOf() - at(clock).valueOf()) / 1000);
      clock = (outcome.availableAt.valueOf() - T0.valueOf()) / 1000;
    }
    expect(waits).toEqual([30, 60, 100, 100]);
  });

  it(`${name}: answers « lost » to a failure from a worker that no longer holds the lease`, async () => {
    const store = await make();
    const id = await put(store);
    await claimFor(store, "w1", 0);
    await claimFor(store, "w2", 60);
    expect(await store.fail(id, "w1", "late", { now: at(61), ...RULES })).toEqual({ state: "lost" });
  });

  it(`${name}: marks dead a message whose last allowed attempt's lease expired with no answer`, async () => {
    const store = await make();
    const id = await put(store);
    await claimFor(store, "w", 0);
    await claimFor(store, "w", 60);
    await claimFor(store, "w", 120); // the 3rd and last attempt; the worker dies
    expect(await claimFor(store, "w", 180)).toEqual([]);
    expect(await store.stats(at(181))).toMatchObject({ dead: 1, pending: 0 });
    expect(await store.retryDead(id, at(190))).toBe(true);
    expect((await claimFor(store, "w", 190))[0]).toMatchObject({ id, attempts: 1 });
  });

  it(`${name}: waits for the scheduled instant, filters by topic and honours the limit`, async () => {
    const store = await make();
    await put(store, { topic: "later", availableAt: at(500) });
    await put(store, { topic: "mail" });
    await put(store, { topic: "mail" });
    await put(store, { topic: "other" });
    expect(await claimFor(store, "w", 0, { topic: "later" })).toEqual([]);
    expect(await claimFor(store, "w", 0, { topic: "mail", limit: 1 })).toHaveLength(1);
    expect(await claimFor(store, "w", 0, { topic: "mail" })).toHaveLength(1);
    expect(await claimFor(store, "w", 500, { topic: "later" })).toHaveLength(1);
    expect(await claimFor(store, "w", 0, { topic: "other" })).toHaveLength(1);
  });

  it(`${name}: purges what is delivered or dead and older than the cut-off, and keeps the rest`, async () => {
    const store = await make();
    await put(store);
    await put(store); // one is delivered, the other stays pending
    const [first] = await claimFor(store, "w", 0, { limit: 1 });
    await store.complete(first!.id, "w", at(10));
    expect(await store.purgeBefore(at(5))).toBe(0);
    expect(await store.purgeBefore(at(20))).toBe(1);
    expect(await store.stats(at(30))).toMatchObject({ delivered: 0, pending: 1 });
  });

  it(`${name}: never gives one message to two workers claiming at once`, async () => {
    const store = await make();
    for (let i = 0; i < 40; i += 1) await put(store);
    const claimers = Array.from({ length: 5 }, (_, i) => async () => {
      const mine: string[] = [];
      for (;;) {
        const batch = await claimFor(store, `w${i}`, 0, { limit: 4, lease: 600 });
        if (batch.length === 0) return mine;
        mine.push(...batch.map((m) => m.id));
      }
    });
    const taken = (await Promise.all(claimers.map((run) => run()))).flat();
    expect(taken).toHaveLength(40);
    expect(new Set(taken).size).toBe(40);
  });
}
