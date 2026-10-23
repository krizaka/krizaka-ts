export const REVIEW_STATE = {
  published: "published",
  hiddenByOwner: "hidden_by_owner",
  removedByAdmin: "removed_by_admin",
  pending: "pending",
} as const;
export type ReviewState = (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE];
export type Rating = 1 | 2 | 3 | 4 | 5;

export interface ReviewTarget {
  targetType: string;
  targetId: string;
}

export interface ReviewPage {
  offset?: number;
  limit?: number;
}

export interface ReviewListOptions extends ReviewPage {
  states?: readonly ReviewState[];
}

export interface ReviewRecord extends ReviewTarget {
  id: string;
  subjectId: string;
  rating: Rating;
  text: string | null;
  verified: boolean;
  state: ReviewState;
  createdAt: Date;
  updatedAt: Date;
  ownerReply: string | null;
  ownerRepliedAt: Date | null;
}

export interface ReviewStore {
  upsert(record: ReviewRecord): Promise<ReviewRecord>;
  get(id: string): Promise<ReviewRecord | null>;
  getBySubjectTarget(subjectId: string, target: ReviewTarget): Promise<ReviewRecord | null>;
  list(target: ReviewTarget, page: Required<ReviewPage>, states: readonly ReviewState[]): Promise<ReviewRecord[]>;
  setState(id: string, state: ReviewState, updatedAt: Date): Promise<void>;
  setReply(id: string, reply: string, repliedAt: Date): Promise<void>;
  scoreDistribution(target: ReviewTarget): Promise<Record<Rating, number>>;
}

export interface Clock {
  now(): Date;
}
