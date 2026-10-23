export interface FollowTarget {
  targetType: string;
  targetId: string;
}

export interface FollowPage {
  offset?: number;
  limit?: number;
}

export interface FollowPreferences {
  email: boolean;
  push: boolean;
  inApp: boolean;
}

export interface FollowRecord extends FollowTarget {
  subjectId: string;
  createdAt: Date;
  preferences: FollowPreferences;
  muted: boolean;
}

export interface FollowStore {
  get(subjectId: string, target: FollowTarget): Promise<FollowRecord | null>;
  insert(record: FollowRecord): Promise<void>;
  delete(subjectId: string, target: FollowTarget): Promise<void>;
  update(subjectId: string, target: FollowTarget, patch: Partial<Pick<FollowRecord, "preferences" | "muted">>): Promise<void>;
  followers(target: FollowTarget, page: Required<FollowPage>): Promise<FollowRecord[]>;
  following(subjectId: string, page: Required<FollowPage>): Promise<FollowRecord[]>;
  count(target: FollowTarget): Promise<number>;
}

export interface Clock {
  now(): Date;
}
