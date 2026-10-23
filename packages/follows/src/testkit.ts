import { expect, it } from "vitest";

import type { FollowRecord, FollowStore } from "./port";

export function followStoreContract(name: string, make: () => FollowStore | Promise<FollowStore>, subject: (n: number) => string | Promise<string>) {
  const target = { targetType: "shop", targetId: "shop-1" };
  const record = (subjectId: string, over: Partial<FollowRecord> = {}): FollowRecord => ({
    subjectId,
    ...target,
    createdAt: new Date("2026-10-22T12:00:00Z"),
    preferences: { email: true, push: true, inApp: true },
    muted: false,
    ...over,
  });

  it(`${name}: inserts, retrieves and deletes follows idempotently`, async () => {
    const store = await make();
    const r = record(await subject(1));
    await store.insert(r);
    await store.insert(r);
    expect(await store.get(r.subjectId, target)).toEqual(r);
    await store.delete(r.subjectId, target);
    await store.delete(r.subjectId, target);
    expect(await store.get(r.subjectId, target)).toBeNull();
  });

  it(`${name}: updates preferences and mute without leaking changes between records`, async () => {
    const store = await make();
    const a = record(await subject(2));
    const b = record(await subject(3));
    await store.insert(a);
    await store.insert(b);
    await store.update(a.subjectId, target, { preferences: { email: false, push: true, inApp: false }, muted: true });
    expect(await store.get(a.subjectId, target)).toMatchObject({ preferences: { email: false, push: true, inApp: false }, muted: true });
    expect(await store.get(b.subjectId, target)).toEqual(b);
  });

  it(`${name}: paginates followers and following and counts a target`, async () => {
    const store = await make();
    const [a, b, other] = await Promise.all([subject(4), subject(5), subject(6)]);
    await store.insert(record(b, { createdAt: new Date("2026-10-23T12:00:00Z") }));
    await store.insert(record(a, { createdAt: new Date("2026-10-22T12:00:00Z") }));
    await store.insert(record(other, { targetId: "shop-2" }));
    expect((await store.followers(target, { offset: 0, limit: 1 })).map((r) => r.subjectId)).toEqual([a]);
    expect((await store.followers(target, { offset: 1, limit: 1 })).map((r) => r.subjectId)).toEqual([b]);
    expect(await store.following(a, { offset: 0, limit: 10 })).toHaveLength(1);
    expect(await store.count(target)).toBe(2);
  });
}
