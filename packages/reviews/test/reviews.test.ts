import { describe, expect, it } from "vitest";

import { memoryReviewStore } from "../src/memory";
import { createReviews } from "../src/reviews";

describe("reviews", () => {
  it("validates input and allows editing the single review", async () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const reviews = createReviews({ store: memoryReviewStore(), clock: { now: () => now }, rules: { initialState: "pending" } });
    const input = { subjectId: "customer-1", target: { targetType: "shop", targetId: "shop-1" }, rating: 5, text: "  Excellent  ", verified: true };
    const first = await reviews.submit(input);
    const edited = await reviews.submit({ ...input, rating: 4, text: "Updated" });
    expect(edited).toMatchObject({ id: first.id, rating: 4, text: "Updated", state: "pending", createdAt: first.createdAt });
    await expect(reviews.submit({ ...input, rating: 2.5 })).rejects.toThrow(RangeError);
    await expect(reviews.submit({ ...input, rating: 6 })).rejects.toThrow(RangeError);
    await expect(reviews.submit({ ...input, text: "x".repeat(1001) })).rejects.toThrow(RangeError);
  });

  it("computes a Bayesian average and counts only published verified reviews", async () => {
    let tick = 0;
    const reviews = createReviews({
      store: memoryReviewStore(),
      clock: { now: () => new Date(`2026-10-22T12:00:0${tick++}Z`) },
      rules: { initialState: "published" },
    });
    const target = { targetType: "shop", targetId: "shop-1" };
    await reviews.submit({ subjectId: "a", target, rating: 5, verified: true });
    await reviews.submit({ subjectId: "b", target, rating: 3, verified: true });
    await reviews.submit({ subjectId: "c", target, rating: 1, verified: false });
    const pending = await reviews.submit({ subjectId: "d", target, rating: 1, verified: true });
    await reviews.setState(pending.id, "pending");
    expect(await reviews.score(target, { mean: 4, weight: 2 })).toEqual({ average: 4, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 }, n: 2 });
    await reviews.reply((await reviews.list(target))[0]!.id, "Thanks");
    expect((await reviews.list(target))[0]!.ownerReply).toBe("Thanks");
  });

  it("validates priors and accepts an owner reply only when non-empty", async () => {
    const reviews = createReviews({ store: memoryReviewStore(), clock: { now: () => new Date() }, rules: { initialState: "published" } });
    const target = { targetType: "shop", targetId: "shop-1" };
    await expect(reviews.score(target, { mean: 0, weight: 2 })).rejects.toThrow(RangeError);
    const review = await reviews.submit({ subjectId: "a", target, rating: 5, verified: true });
    await expect(reviews.reply(review.id, " ")).rejects.toThrow(RangeError);
  });
});
