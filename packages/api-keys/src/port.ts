/**
 * The API-KEY ports (ADR-0011). Generic on purpose — no import from this app (no env, no database client, no clock of its own),
 * so the folder moves as it is into `@krizaka/api-keys` (Krizaka TS, krizaka/.github#183) and Akinaza uses the same code.
 * A key is `<prefix>_<publicId>_<secret>`: the publicId finds the record, only a SHA-256 of the secret is stored, and the whole
 * key is shown once, when it is created or rotated. What a product decides — its scopes, its limits per plan, its rate limits, its
 * audit trail — is data or an adapter around this module, never inside it.
 */
export interface ApiKeyRules {
  /** The product's prefix (`yzk`): it makes a leaked key recognisable and revocable by secret scanners. */
  prefix: string;
  /** The scopes a key of this product may carry (`checks:write`, `reports:read`). */
  scopes: readonly string[];
  secretBytes: number;
  /** The longest a key may live: a key without an end is refused. */
  maxExpiryDays: number;
  /** How long a rotated key keeps working beside its replacement, so a client can switch without downtime. */
  rotationGraceHours: number;
  /** « Last used » is written at most this often (a busy key must not write on every request). */
  lastUsedEveryMinutes: number;
}

export interface ApiKeyRecord {
  id: string;
  ownerId: string;
  name: string;
  publicId: string;
  /** SHA-256 of the secret, hex. The secret itself is never stored. */
  secretHash: string;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** The key this one replaced, when it came from a rotation. */
  rotatedFromId: string | null;
  /** When a rotated-out key stops working (its grace period's end); null while it is the current one. */
  supersededAt: Date | null;
}

/** What a person sees of a key: never the hash, never the secret. */
export interface ApiKeyView {
  id: string;
  name: string;
  /** The first characters of the key (`yzk_1a2b3c4d5e6f`): enough to recognise it, useless to use it. */
  hint: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** `active` | `expired` | `revoked` | `rotated` (replaced, still working until its grace ends). */
  status: "active" | "expired" | "revoked" | "rotated";
}

export interface ApiKeyStore {
  insert(record: ApiKeyRecord): Promise<void>;
  get(id: string): Promise<ApiKeyRecord | null>;
  findByPublicId(publicId: string): Promise<ApiKeyRecord | null>;
  list(ownerId: string): Promise<ApiKeyRecord[]>;
  update(id: string, patch: Partial<Pick<ApiKeyRecord, "lastUsedAt" | "revokedAt" | "supersededAt">>): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const API_KEY_CODE = {
  missing: "API_KEY_MISSING",
  invalid: "API_KEY_INVALID",
  expired: "API_KEY_EXPIRED",
  revoked: "API_KEY_REVOKED",
  superseded: "API_KEY_SUPERSEDED",
  scope: "API_KEY_SCOPE",
  scopeUnknown: "API_KEY_SCOPE_UNKNOWN",
  name: "API_KEY_NAME",
  expiry: "API_KEY_EXPIRY",
  limit: "API_KEY_LIMIT",
  notFound: "API_KEY_NOT_FOUND",
} as const;
export type ApiKeyCode = (typeof API_KEY_CODE)[keyof typeof API_KEY_CODE];

export class ApiKeyError extends Error {
  constructor(readonly code: ApiKeyCode) {
    super(code);
  }
}

export type Authenticated = { ok: true; key: ApiKeyRecord } | { ok: false; code: ApiKeyCode };
