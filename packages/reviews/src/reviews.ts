import crypto from "node:crypto";

import { type Clock, type Rating, REVIEW_STATE, type ReviewPage, type ReviewRecord, type ReviewState, type ReviewStore, type ReviewTarget } from "./port";

const STATES: readonly ReviewState[] = Object.values(REVIEW_STATE);
const DEFAULT_PAGE = { offset: 0, limit: 20 };
const MAX_PAGE_SIZE = 100;

function pageOf(page: ReviewPage = {}): Required<ReviewPage> {
  const offset = page.offset ?? DEFAULT_PAGE.offset;
  const limit = page.limit ?? DEFAULT_PAGE.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError("invalid review page");
  }
  return { offset, limit };
}

export function createReviews(deps: { store: ReviewStore; clock: Clock; rules: { initialState: ReviewState } }) {
  const { store, clock, rules } = deps;
  if (!STATES.includes(rules.initialState)) throw new RangeError("invalid initial review state");

  return {
    async submit(input: { subjectId: string; target: ReviewTarget; rating: number; text?: string | null; verified: boolean }): Promise<ReviewRecord> {
      if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new RangeError("rating must be an integer from 1 to 5");
      if (typeof input.verified !== "boolean") throw new TypeError("verified must be supplied by the product");
      const text = input.text?.trim() || null;
      if (text && Array.from(text).length > 1000) throw new RangeError("review text must be at most 1000 characters");
      const existing = await store.getBySubjectTarget(input.subjectId, input.target);
      const now = clock.now();
      return store.upsert({
        id: existing?.id ?? crypto.randomUUID(),
        subjectId: input.subjectId,
        ...input.target,
        rating: input.rating as Rating,
        text,
        verified: input.verified,
        state: existing?.state ?? rules.initialState,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ownerReply: existing?.ownerReply ?? null,
        ownerRepliedAt: existing?.ownerRepliedAt ?? null,
      });
    },

    get(id: string): Promise<ReviewRecord | null> {
      return store.get(id);
    },

    async list(target: ReviewTarget, page?: ReviewPage): Promise<ReviewRecord[]> {
      return store.list(target, pageOf(page));
    },

    async setState(id: string, state: ReviewState): Promise<void> {
      if (!STATES.includes(state)) throw new RangeError("invalid review state");
      if (!(await store.get(id))) throw new Error("review not found");
      await store.setState(id, state, clock.now());
    },

    async reply(id: string, text: string): Promise<void> {
      const reply = text.trim();
      if (!reply) throw new RangeError("reply must not be empty");
      if (!(await store.get(id))) throw new Error("review not found");
      await store.setReply(id, reply, clock.now());
    },

    async score(target: ReviewTarget, prior: { mean: number; weight: number }): Promise<{ average: number; distribution: Record<Rating, number>; n: number }> {
      if (!Number.isFinite(prior.mean) || prior.mean < 1 || prior.mean > 5 || !Number.isFinite(prior.weight) || prior.weight <= 0) {
        throw new RangeError("invalid review score prior");
      }
      const ratings = await store.scoreRatings(target);
      const distribution: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const rating of ratings) distribution[rating] += 1;
      const n = ratings.length;
      return { average: (prior.weight * prior.mean + ratings.reduce((sum, rating) => sum + rating, 0)) / (prior.weight + n), distribution, n };
    },
  };
}

export type Reviews = ReturnType<typeof createReviews>;
