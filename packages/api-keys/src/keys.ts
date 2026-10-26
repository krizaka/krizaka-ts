import crypto from "node:crypto";

import { addDays, addHours, differenceInDays, differenceInMinutes } from "date-fns";

import { API_KEY_CODE, type ApiKeyCode, ApiKeyError, type ApiKeyRecord, type ApiKeyRules, type ApiKeyStore, type ApiKeyView, type Authenticated, type Clock } from "./port";

const PUBLIC_ID_BYTES = 6;

const sha256 = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface NewKey {
  name: string;
  scopes: readonly string[];
  /** Days from now; a key must end (≤ the rules' cap). */
  expiresInDays: number | null;
}

export interface Created {
  /** The whole key. Shown once: nothing here can show it again. */
  key: string;
  record: ApiKeyRecord;
}

/**
 * API keys: created, authenticated, rotated, revoked. The plan's limit on how many a person may hold is the caller's to say
 * (`maxActive`): plans are the product's data. The clock is injected (a test moves it; nothing here reads the wall clock).
 */
export function createApiKeys(deps: { store: ApiKeyStore; rules: ApiKeyRules; clock: Clock }) {
  const { store, rules, clock } = deps;
  const header = new RegExp(`^${rules.prefix}_([0-9a-f]{${PUBLIC_ID_BYTES * 2}})_([A-Za-z0-9_-]{16,128})$`);

  const isLive = (r: ApiKeyRecord, now: Date) => !r.revokedAt && !(r.expiresAt && r.expiresAt <= now) && !(r.supersededAt && r.supersededAt <= now);
  const statusOf = (r: ApiKeyRecord, now: Date): ApiKeyView["status"] => (r.revokedAt ? "revoked" : r.expiresAt && r.expiresAt <= now ? "expired" : r.supersededAt ? "rotated" : "active");

  function check(input: NewKey) {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new ApiKeyError(API_KEY_CODE.name);
    if (input.scopes.length === 0 || input.scopes.some((s) => !rules.scopes.includes(s))) throw new ApiKeyError(API_KEY_CODE.scopeUnknown);
    if (input.expiresInDays === null || !Number.isFinite(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > rules.maxExpiryDays) throw new ApiKeyError(API_KEY_CODE.expiry);
    return { name, scopes: [...new Set(input.scopes)] };
  }

  async function issue(ownerId: string, input: NewKey, extra: Pick<ApiKeyRecord, "rotatedFromId">): Promise<Created> {
    const { name, scopes } = check(input);
    const now = clock.now();
    const publicId = crypto.randomBytes(PUBLIC_ID_BYTES).toString("hex");
    const secret = crypto.randomBytes(rules.secretBytes).toString("base64url");
    const record: ApiKeyRecord = { id: crypto.randomUUID(), ownerId, name, publicId, secretHash: sha256(secret), scopes, expiresAt: addDays(now, input.expiresInDays!), createdAt: now, lastUsedAt: null, revokedAt: null, rotatedFromId: extra.rotatedFromId, supersededAt: null };
    await store.insert(record);
    return { key: `${rules.prefix}_${publicId}_${secret}`, record };
  }

  async function owned(ownerId: string, id: string): Promise<ApiKeyRecord> {
    const record = await store.get(id);
    if (!record || record.ownerId !== ownerId) throw new ApiKeyError(API_KEY_CODE.notFound);
    return record;
  }

  async function activeCount(ownerId: string, now: Date, except?: string) {
    return (await store.list(ownerId)).filter((r) => r.id !== except && isLive(r, now)).length;
  }

  return {
    async create(ownerId: string, input: NewKey, plan: { maxActive: number }): Promise<Created> {
      if ((await activeCount(ownerId, clock.now())) >= plan.maxActive) throw new ApiKeyError(API_KEY_CODE.limit);
      return issue(ownerId, input, { rotatedFromId: null });
    },

    /** A new key with the same name, scopes and length of life; the old one keeps working for the grace period, then stops. */
    async rotate(ownerId: string, id: string, plan: { maxActive: number }): Promise<Created> {
      const old = await owned(ownerId, id);
      const now = clock.now();
      if (old.revokedAt) throw new ApiKeyError(API_KEY_CODE.revoked);
      if (old.supersededAt) throw new ApiKeyError(API_KEY_CODE.superseded);
      if ((await activeCount(ownerId, now, old.id)) >= plan.maxActive) throw new ApiKeyError(API_KEY_CODE.limit);
      const lifeDays = Math.max(1, Math.min(rules.maxExpiryDays, old.expiresAt ? differenceInDays(old.expiresAt, old.createdAt) : 1));
      const created = await issue(ownerId, { name: old.name, scopes: old.scopes, expiresInDays: lifeDays }, { rotatedFromId: old.id });
      await store.update(old.id, { supersededAt: addHours(now, rules.rotationGraceHours) });
      return created;
    },

    async revoke(ownerId: string, id: string): Promise<void> {
      const record = await owned(ownerId, id);
      if (!record.revokedAt) await store.update(id, { revokedAt: clock.now() });
    },

    async list(ownerId: string): Promise<ApiKeyRecord[]> {
      return store.list(ownerId);
    },

    publicView(record: ApiKeyRecord): ApiKeyView {
      const now = clock.now();
      return { id: record.id, name: record.name, hint: `${rules.prefix}_${record.publicId}`, scopes: record.scopes, expiresAt: record.expiresAt?.toISOString() ?? null, createdAt: record.createdAt.toISOString(), lastUsedAt: record.lastUsedAt?.toISOString() ?? null, revokedAt: record.revokedAt?.toISOString() ?? null, status: statusOf(record, now) };
    },

    /** `Authorization: Bearer <key>`: the key's owner and the key, or the stable code of the refusal. */
    async authenticate(authorization: string | null, scope: string): Promise<Authenticated> {
      const bearer = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
      if (!bearer) return { ok: false, code: API_KEY_CODE.missing };
      const parts = header.exec(bearer);
      if (!parts) return { ok: false, code: API_KEY_CODE.invalid };
      const record = await store.findByPublicId(parts[1]!);
      // The same answer, and the same work, for an unknown key and a wrong secret.
      const hash = sha256(parts[2]!);
      if (!record || !same(record.secretHash, hash)) return { ok: false, code: API_KEY_CODE.invalid };
      const now = clock.now();
      const refusal = refusalOf(record, scope, now);
      if (refusal) return { ok: false, code: refusal };
      if (!record.lastUsedAt || differenceInMinutes(now, record.lastUsedAt) >= rules.lastUsedEveryMinutes) await store.update(record.id, { lastUsedAt: now });
      return { ok: true, key: record };
    },
  };
}

/** Why a key that exists and matches is still refused, in the order the codes are told. */
function refusalOf(record: ApiKeyRecord, scope: string, now: Date): ApiKeyCode | null {
  if (record.revokedAt) return API_KEY_CODE.revoked;
  if (record.supersededAt && record.supersededAt <= now) return API_KEY_CODE.superseded;
  if (record.expiresAt && record.expiresAt <= now) return API_KEY_CODE.expired;
  if (!record.scopes.includes(scope)) return API_KEY_CODE.scope;
  return null;
}

export type ApiKeys = ReturnType<typeof createApiKeys>;
