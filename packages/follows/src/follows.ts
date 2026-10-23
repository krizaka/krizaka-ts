import type { Clock, FollowPage, FollowPreferences, FollowRecord, FollowStore, FollowTarget } from "./port";

const DEFAULT_PREFERENCES: FollowPreferences = { email: true, push: true, inApp: true };
const DEFAULT_PAGE = { offset: 0, limit: 20 };
const MAX_PAGE_SIZE = 100;

function pageOf(page: FollowPage = {}): Required<FollowPage> {
  const offset = page.offset ?? DEFAULT_PAGE.offset;
  const limit = page.limit ?? DEFAULT_PAGE.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError("invalid follow page");
  }
  return { offset, limit };
}

export function createFollows(deps: { store: FollowStore; clock: Clock }) {
  const { store, clock } = deps;
  return {
    async follow(subjectId: string, target: FollowTarget, preferences: FollowPreferences = DEFAULT_PREFERENCES): Promise<FollowRecord> {
      const existing = await store.get(subjectId, target);
      if (existing) return existing;
      const record: FollowRecord = { subjectId, ...target, createdAt: clock.now(), preferences: { ...preferences }, muted: false };
      await store.insert(record);
      return (await store.get(subjectId, target)) ?? record;
    },

    unfollow(subjectId: string, target: FollowTarget): Promise<void> {
      return store.delete(subjectId, target);
    },

    async isFollowing(subjectId: string, target: FollowTarget): Promise<boolean> {
      return (await store.get(subjectId, target)) !== null;
    },

    async followers(target: FollowTarget, page?: FollowPage): Promise<FollowRecord[]> {
      return store.followers(target, pageOf(page));
    },

    async following(subjectId: string, page?: FollowPage): Promise<FollowRecord[]> {
      return store.following(subjectId, pageOf(page));
    },

    count(target: FollowTarget): Promise<number> {
      return store.count(target);
    },

    async updatePreferences(subjectId: string, target: FollowTarget, preferences: FollowPreferences): Promise<void> {
      if (!(await store.get(subjectId, target))) return;
      await store.update(subjectId, target, { preferences: { ...preferences } });
    },

    async mute(subjectId: string, target: FollowTarget, muted = true): Promise<void> {
      if (!(await store.get(subjectId, target))) return;
      await store.update(subjectId, target, { muted });
    },
  };
}

export type Follows = ReturnType<typeof createFollows>;
