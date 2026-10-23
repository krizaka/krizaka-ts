import { expect, it } from "vitest";

import type { AuditInsert, AuditStore } from "./port";

/**
 * What every AuditStore adapter must do: the same behaviour behind the same port. `owner(n)` gives an actor id the adapter
 * accepts (an account of the product). Each case writes under its own action prefix, so the cases share one database.
 * @param name the adapter's name, shown in the test titles
 * @param make builds the store
 * @param owner the n-th actor id
 */
export function auditStoreContract(name: string, make: () => AuditStore | Promise<AuditStore>, owner: (n: number) => string | Promise<string>) {
  const tag = () => `t${Math.random().toString(36).slice(2, 10)}`;
  const entry = (prefix: string, over: Partial<AuditInsert> = {}): AuditInsert => ({
    at: new Date("2026-10-23T10:00:00Z"),
    actorId: null,
    actorLabel: "system",
    action: `${prefix}.done`,
    targetType: null,
    targetId: null,
    detail: {},
    ip: null,
    ...over,
  });

  it(`${name}: keeps every field and lists the newest first`, async () => {
    const store = await make();
    const p = tag();
    const actor = await owner(1);
    await store.insert(entry(p, { at: new Date("2026-10-23T09:00:00Z"), action: `${p}.first` }));
    await store.insert(entry(p, { actorId: actor, actorLabel: "Eric", action: `${p}.second`, targetType: "shop", targetId: "s1", detail: { n: 2, tags: ["a"] }, ip: "203.0.113.9" }));
    const listed = await store.list({ actionPrefix: `${p}.` });
    expect(listed.map((e) => e.action)).toEqual([`${p}.second`, `${p}.first`]);
    expect(listed[0]).toMatchObject({ actorId: actor, actorLabel: "Eric", targetType: "shop", targetId: "s1", detail: { n: 2, tags: ["a"] }, ip: "203.0.113.9" });
    expect(listed[0]!.at.toISOString()).toBe("2026-10-23T10:00:00.000Z");
    expect(typeof listed[0]!.id).toBe("string");
  });

  it(`${name}: filters by actor, target and time window`, async () => {
    const store = await make();
    const p = tag();
    const [a, b] = [await owner(2), await owner(3)];
    await store.insert(entry(p, { actorId: a, targetType: "shop", targetId: "x", at: new Date("2026-10-01T00:00:00Z") }));
    await store.insert(entry(p, { actorId: b, targetType: "shop", targetId: "y", at: new Date("2026-10-10T00:00:00Z") }));
    expect(await store.list({ actionPrefix: p, actorId: a })).toHaveLength(1);
    expect((await store.list({ actionPrefix: p, target: { type: "shop", id: "y" } }))[0]!.actorId).toBe(b);
    expect(await store.list({ actionPrefix: p, from: new Date("2026-10-05T00:00:00Z") })).toHaveLength(1);
    expect(await store.list({ actionPrefix: p, to: new Date("2026-10-05T00:00:00Z") })).toHaveLength(1);
  });

  it(`${name}: pages with a limit and a cursor (the last id seen)`, async () => {
    const store = await make();
    const p = tag();
    for (let i = 0; i < 5; i++) await store.insert(entry(p, { action: `${p}.n${i}` }));
    const page1 = await store.list({ actionPrefix: p, limit: 2 });
    const page2 = await store.list({ actionPrefix: p, limit: 2, before: page1.at(-1)!.id });
    expect(page1.map((e) => e.action)).toEqual([`${p}.n4`, `${p}.n3`]);
    expect(page2.map((e) => e.action)).toEqual([`${p}.n2`, `${p}.n1`]);
  });

  it(`${name}: exports one actor's entries and redacts them (Loi 25), leaving the others`, async () => {
    const store = await make();
    const p = tag();
    const [gone, stays] = [await owner(4), await owner(5)];
    await store.insert(entry(p, { actorId: gone, actorLabel: "Gone", ip: "198.51.100.1" }));
    await store.insert(entry(p, { actorId: stays, actorLabel: "Stays" }));
    expect((await store.forActor(gone)).filter((e) => e.action.startsWith(p))).toHaveLength(1);
    expect(await store.redactActor(gone)).toBeGreaterThanOrEqual(1);
    const after = await store.list({ actionPrefix: p });
    expect(after.find((e) => e.actorLabel === "Stays")!.actorId).toBe(stays);
    expect(after.find((e) => e.actorLabel !== "Stays")).toMatchObject({ actorId: null, actorLabel: "erased", ip: null });
    expect((await store.forActor(gone)).filter((e) => e.action.startsWith(p))).toEqual([]);
  });

  it(`${name}: ids never repeat after a purge, so a cursor never skips an entry`, async () => {
    const store = await make();
    const p = tag();
    await store.insert(entry(p, { action: `${p}.old`, at: new Date("2020-01-01T00:00:00Z") }));
    await store.insert(entry(p, { action: `${p}.kept`, at: new Date("2026-10-01T00:00:00Z") }));
    await store.purgeBefore(new Date("2021-01-01T00:00:00Z"));
    await store.insert(entry(p, { action: `${p}.after`, at: new Date("2026-10-02T00:00:00Z") }));
    const all = await store.list({ actionPrefix: p });
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    const first = await store.list({ actionPrefix: p, limit: 1 });
    const rest = await store.list({ actionPrefix: p, before: first[0]!.id });
    expect([...first, ...rest].map((e) => e.action)).toEqual([`${p}.after`, `${p}.kept`]);
  });

  it(`${name}: the trail cannot be changed by mutating what was given or what was read`, async () => {
    const store = await make();
    const p = tag();
    const input = entry(p, { detail: { nested: { n: 1 } } });
    await store.insert(input);
    input.at.setUTCFullYear(1999);
    (input.detail.nested as { n: number }).n = 99;
    const [read] = await store.list({ actionPrefix: p });
    read!.at.setUTCFullYear(1999);
    (read!.detail.nested as { n: number }).n = 42;
    read!.actorLabel = "forged";
    const [again] = await store.list({ actionPrefix: p });
    expect(again).toMatchObject({ actorLabel: "system", detail: { nested: { n: 1 } } });
    expect(again!.at.toISOString()).toBe("2026-10-23T10:00:00.000Z");
    const [exported] = await store.forActor("00000000-0000-4000-8000-000000000000");
    expect(exported).toBeUndefined();
  });

  it(`${name}: purges only what is older than the given time, and counts it`, async () => {
    const store = await make();
    const p = tag();
    await store.insert(entry(p, { action: `${p}.old`, at: new Date("2020-01-01T00:00:00Z") }));
    await store.insert(entry(p, { action: `${p}.new`, at: new Date("2026-10-01T00:00:00Z") }));
    expect(await store.purgeBefore(new Date("2021-01-01T00:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect((await store.list({ actionPrefix: p })).map((e) => e.action)).toEqual([`${p}.new`]);
  });
}
