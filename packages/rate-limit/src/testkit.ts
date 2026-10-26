import { expect, it } from "vitest";

import type { LimitStore } from "./port";

const T0 = new Date("2026-10-26T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.valueOf() + seconds * 1000);

/** What every `LimitStore` adapter must do: the same behaviour behind the same port. `make` gives a store with no counters. */
export function limitStoreContract(name: string, make: () => LimitStore | Promise<LimitStore>) {
  it(`${name}: counts hits in a window that the first hit starts`, async () => {
    const store = await make();
    const first = await store.hit("k", 60, T0);
    expect(first.count).toBe(1);
    expect(first.resetAt.toISOString()).toBe(at(60).toISOString());
    const later = await store.hit("k", 60, at(30));
    expect(later.count).toBe(2);
    expect(later.resetAt.toISOString()).toBe(at(60).toISOString()); // a later hit does not extend the window
  });

  it(`${name}: starts a new window when the last one has ended`, async () => {
    const store = await make();
    await store.hit("k", 60, T0);
    await store.hit("k", 60, at(10));
    const next = await store.hit("k", 60, at(60));
    expect(next.count).toBe(1);
    expect(next.resetAt.toISOString()).toBe(at(120).toISOString());
  });

  it(`${name}: keeps keys apart`, async () => {
    const store = await make();
    await store.hit("a", 60, T0);
    await store.hit("a", 60, T0);
    expect((await store.hit("b", 60, T0)).count).toBe(1);
  });

  it(`${name}: peeks without counting, and only while the window is open`, async () => {
    const store = await make();
    expect(await store.peek("k", T0)).toBeNull();
    await store.hit("k", 60, T0);
    expect((await store.peek("k", at(1)))?.count).toBe(1);
    expect((await store.peek("k", at(1)))?.count).toBe(1);
    expect(await store.peek("k", at(60))).toBeNull();
  });

  it(`${name}: opens a lock-out with set, and forgets with reset`, async () => {
    const store = await make();
    await store.set("k", 99, 300, T0);
    expect(await store.peek("k", at(299))).toMatchObject({ count: 99 });
    expect((await store.hit("k", 60, at(10))).count).toBe(100);
    await store.reset("k");
    expect(await store.peek("k", at(11))).toBeNull();
    await store.reset("k"); // twice: safe
  });

  it(`${name}: purges the ended windows and only those`, async () => {
    const store = await make();
    await store.hit("short", 10, T0);
    await store.hit("long", 600, T0);
    expect(await store.purge(at(30))).toBe(1);
    expect(await store.peek("short", at(30))).toBeNull();
    expect((await store.peek("long", at(30)))?.count).toBe(1);
  });

  it(`${name}: counts parallel hits exactly`, async () => {
    const store = await make();
    const hits = await Promise.all(Array.from({ length: 100 }, () => store.hit("burst", 60, T0)));
    expect(hits.map((h) => h.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect((await store.peek("burst", at(1)))?.count).toBe(100);
  });
}
