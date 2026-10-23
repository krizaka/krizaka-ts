import { describe, expect, it } from "vitest";

import { createFollows } from "../src/follows";
import { memoryFollowStore } from "../src/memory";

describe("follows", () => {
  it("is idempotent, supports preference and mute changes, and uses the injected clock", async () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const follows = createFollows({ store: memoryFollowStore(), clock: { now: () => now } });
    const target = { targetType: "shop", targetId: "shop-1" };
    const record = await follows.follow("customer-1", target);
    expect(await follows.follow("customer-1", target, { email: false, push: false, inApp: false })).toEqual(record);
    await follows.updatePreferences("customer-1", target, { email: false, push: true, inApp: false });
    await follows.mute("customer-1", target);
    expect(await follows.isFollowing("customer-1", target)).toBe(true);
    expect(await follows.following("customer-1")).toMatchObject([{ createdAt: now, preferences: { email: false, push: true, inApp: false }, muted: true }]);
    await follows.unfollow("customer-1", target);
    expect(await follows.count(target)).toBe(0);
    expect(await follows.isFollowing("customer-1", target)).toBe(false);
  });

  it("rejects unsafe pagination", async () => {
    const follows = createFollows({ store: memoryFollowStore(), clock: { now: () => new Date() } });
    await expect(follows.followers({ targetType: "shop", targetId: "shop-1" }, { offset: -1 })).rejects.toThrow(RangeError);
  });
});
