/** Stable refusal codes: a product turns them into its own HTTP answers and messages. */
export const ORGANIZE_CODE = {
  notFound: "NOT_FOUND",
  badRequest: "BAD_REQUEST",
  nameTaken: "NAME_TAKEN",
  defaultCollection: "DEFAULT_COLLECTION",
  noDefaultCollection: "NO_DEFAULT_COLLECTION",
  avatarNotAllowed: "AVATAR_NOT_ALLOWED",
  avatarTooLarge: "AVATAR_TOO_LARGE",
  avatarUnreadable: "AVATAR_UNREADABLE",
  avatarStorageUnavailable: "AVATAR_STORAGE_UNAVAILABLE",
  avatarStorageOff: "AVATAR_STORAGE_OFF",
  forbidden: "FORBIDDEN",
  conflict: "CONFLICT",
  stale: "STALE",
  statusDerived: "STATUS_DERIVED",
  moveNotAllowed: "MOVE_NOT_ALLOWED",
  stateInUse: "STATE_IN_USE",
  tagLimit: "TAG_LIMIT",
  tooMany: "TOO_MANY",
  already: "ALREADY",
} as const;
export type OrganizeCode = (typeof ORGANIZE_CODE)[keyof typeof ORGANIZE_CODE];

const STATUS: Record<OrganizeCode, number> = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  NAME_TAKEN: 409,
  DEFAULT_COLLECTION: 409,
  NO_DEFAULT_COLLECTION: 500,
  AVATAR_NOT_ALLOWED: 400,
  AVATAR_TOO_LARGE: 413,
  AVATAR_UNREADABLE: 422,
  AVATAR_STORAGE_UNAVAILABLE: 502,
  AVATAR_STORAGE_OFF: 503,
  FORBIDDEN: 403,
  CONFLICT: 409,
  STALE: 409,
  STATUS_DERIVED: 409,
  MOVE_NOT_ALLOWED: 409,
  STATE_IN_USE: 409,
  TAG_LIMIT: 409,
  TOO_MANY: 400,
  ALREADY: 409,
};

export class OrganizeError extends Error {
  readonly status: number;
  constructor(
    readonly code: OrganizeCode,
    message?: string,
  ) {
    super(message ?? code);
    this.status = STATUS[code];
  }
}
