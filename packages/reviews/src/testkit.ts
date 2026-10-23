import { expect, it } from "vitest";

import type { Rating, ReviewRecord, ReviewStore } from "./port";

export function reviewStoreContract(name: string, make: () => ReviewStore | Promise<ReviewStore>, subject: (n: number) => string | Promise<string>) {
  const target = { targetType: "shop", targetId: "shop-1" };
  const record = (subjectId: string, over: Partial<ReviewRecord> = {}): ReviewRecord => ({
    id: crypto.randomUUID(),
    subjectId,
    ...target,
    rating: 5,
    text: "Great",
    verified: true,
    state: "published",
    createdAt: new Date("2026-10-22T12:00:00Z"),
    updatedAt: new Date("2026-10-22T12:00:00Z"),
    ownerReply: null,
    ownerRepliedAt: null,
    ...over,
  });

  it(`${name}: upserts one review per subject and target, retaining its identity`, async () => {
    const store = await make();
    const first = await store.upsert(record(await subject(1)));
    const edit = await store.upsert(record(first.subjectId, { id: crypto.randomUUID(), rating: 4, updatedAt: new Date("2026-10-23T12:00:00Z") }));
    expect(edit).toMatchObject({ id: first.id, rating: 4, createdAt: first.createdAt });
    expect(await store.getBySubjectTarget(first.subjectId, target)).toEqual(edit);
  });

  it(`${name}: stores replies and states and lists a target's reviews`, async () => {
    const store = await make();
    const a = await store.upsert(record(await subject(2)));
    await store.setState(a.id, "pending", new Date("2026-10-23T12:00:00Z"));
    await store.setReply(a.id, "Thank you", new Date("2026-10-23T12:00:00Z"));
    expect(await store.get(a.id)).toMatchObject({ state: "pending", ownerReply: "Thank you" });
    expect(await store.list(target, { offset: 0, limit: 20 })).toHaveLength(1);
  });

  it(`${name}: returns only published verified ratings for scores`, async () => {
    const store = await make();
    await store.upsert(record(await subject(3), { rating: 2 as Rating }));
    await store.upsert(record(await subject(4), { verified: false }));
    await store.upsert(record(await subject(5), { state: "pending" }));
    expect(await store.scoreRatings(target)).toEqual([2]);
  });
}
