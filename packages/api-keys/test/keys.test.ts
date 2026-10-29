import { describe, expect, it } from "vitest";

import { createApiKeys } from "../src/keys";
import { memoryApiKeyStore } from "../src/memory";
import type { ApiKeyRules } from "../src/port";

const RULES: ApiKeyRules = {
  prefix: "yzk",
  scopes: ["checks:write", "reports:read"],
  secretBytes: 24,
  maxExpiryDays: 365,
  rotationGraceHours: 24,
  lastUsedEveryMinutes: 5,
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function setup() {
  let now = new Date("2026-10-22T12:00:00Z");
  const store = memoryApiKeyStore();
  const keys = createApiKeys({ store, rules: RULES, clock: { now: () => now } });
  return { keys, store, advance: (ms: number) => (now = new Date(now.getTime() + ms)), at: () => now };
}
const bearer = (key: string) => `Bearer ${key}`;

describe("creating a key", () => {
  it("shows the key once, in the form prefix_publicId_secret, and stores only a hash of the secret", async () => {
    const { keys, store } = setup();
    const { key, record } = await keys.create(
      "owner-1",
      { name: "Mon ERP", scopes: ["checks:write"], expiresInDays: 90 },
      { maxActive: 5 },
    );
    expect(key).toMatch(/^yzk_[0-9a-f]{12}_[A-Za-z0-9_-]{32}$/);
    expect(record).toMatchObject({
      ownerId: "owner-1",
      name: "Mon ERP",
      scopes: ["checks:write"],
      lastUsedAt: null,
      revokedAt: null,
    });
    // The secret is base64url (it may hold « _ »): it is everything after `yzk_<12 hex>_`.
    const secret = key.slice("yzk_".length + 12 + 1);
    expect(secret).toHaveLength(32);
    expect(JSON.stringify(await store.list("owner-1"))).not.toContain(secret);
    expect(record.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(keys.publicView(record))).not.toMatch(/secretHash|hash/i);
  });

  it("refuses an unknown scope, an empty scope list, a name that is empty, an expiry beyond the cap, and more keys than the plan allows", async () => {
    const { keys } = setup();
    const make = (o: Partial<{ name: string; scopes: string[]; expiresInDays: number | null }>, maxActive = 5) =>
      keys.create("o", { name: "k", scopes: ["checks:write"], expiresInDays: 30, ...o }, { maxActive });
    await expect(make({ scopes: ["admin:all"] })).rejects.toMatchObject({ code: "API_KEY_SCOPE_UNKNOWN" });
    await expect(make({ scopes: [] })).rejects.toMatchObject({ code: "API_KEY_SCOPE_UNKNOWN" });
    await expect(make({ name: "  " })).rejects.toMatchObject({ code: "API_KEY_NAME" });
    await expect(make({ expiresInDays: 400 })).rejects.toMatchObject({ code: "API_KEY_EXPIRY" });
    await expect(make({ expiresInDays: null })).rejects.toMatchObject({ code: "API_KEY_EXPIRY" });
    await make({}, 2);
    await make({}, 2);
    await expect(make({}, 2)).rejects.toMatchObject({ code: "API_KEY_LIMIT" });
    await expect(make({}, 0)).rejects.toMatchObject({ code: "API_KEY_LIMIT" });
  });
});

describe("authenticating a request", () => {
  it("accepts a valid key with the scope it needs, and says whose it is", async () => {
    const { keys } = setup();
    const { key, record } = await keys.create(
      "owner-1",
      { name: "k", scopes: ["checks:write", "reports:read"], expiresInDays: 30 },
      { maxActive: 5 },
    );
    expect(await keys.authenticate(bearer(key), "checks:write")).toMatchObject({
      ok: true,
      key: { id: record.id, ownerId: "owner-1" },
    });
  });

  it("refuses with a stable code: missing, malformed, unknown, wrong secret, missing scope", async () => {
    const { keys } = setup();
    const { key } = await keys.create(
      "o",
      { name: "k", scopes: ["reports:read"], expiresInDays: 30 },
      { maxActive: 5 },
    );
    const [, id, secret] = key.split("_");
    const code = async (header: string | null, scope = "reports:read" as const) => {
      const r = await keys.authenticate(header, scope);
      return r.ok ? "ok" : r.code;
    };
    expect(await code(null)).toBe("API_KEY_MISSING");
    expect(await code("Basic abc")).toBe("API_KEY_MISSING");
    expect(await code(bearer("not-a-key"))).toBe("API_KEY_INVALID");
    expect(await code(bearer(`yzk_${"0".repeat(12)}_${secret}`))).toBe("API_KEY_INVALID");
    expect(await code(bearer(`yzk_${id}_${"x".repeat(32)}`))).toBe("API_KEY_INVALID");
    expect(await code(bearer(key), "checks:write" as never)).toBe("API_KEY_SCOPE");
    expect(await code(bearer(key))).toBe("ok");
  });

  it("an expired key is refused, a revoked key at once", async () => {
    const { keys, advance } = setup();
    const a = await keys.create("o", { name: "a", scopes: ["reports:read"], expiresInDays: 1 }, { maxActive: 5 });
    const b = await keys.create("o", { name: "b", scopes: ["reports:read"], expiresInDays: 30 }, { maxActive: 5 });
    advance(2 * DAY);
    expect(await keys.authenticate(bearer(a.key), "reports:read")).toMatchObject({
      ok: false,
      code: "API_KEY_EXPIRED",
    });
    expect((await keys.authenticate(bearer(b.key), "reports:read")).ok).toBe(true);
    await keys.revoke("o", b.record.id);
    expect(await keys.authenticate(bearer(b.key), "reports:read")).toMatchObject({
      ok: false,
      code: "API_KEY_REVOKED",
    });
  });

  it("records when it was last used, at most once per window", async () => {
    const { keys, store, advance } = setup();
    const { key, record } = await keys.create(
      "o",
      { name: "k", scopes: ["reports:read"], expiresInDays: 30 },
      { maxActive: 5 },
    );
    await keys.authenticate(bearer(key), "reports:read");
    const first = (await store.get(record.id))!.lastUsedAt!;
    advance(60_000);
    await keys.authenticate(bearer(key), "reports:read");
    expect((await store.get(record.id))!.lastUsedAt).toEqual(first);
    advance(10 * 60_000);
    await keys.authenticate(bearer(key), "reports:read");
    expect((await store.get(record.id))!.lastUsedAt!.getTime()).toBeGreaterThan(first.getTime());
  });
});

describe("rotation and revocation", () => {
  it("a rotated key is replaced by a new one with the same name, scopes and expiry; the old one works for the grace period only", async () => {
    const { keys, advance } = setup();
    const old = await keys.create("o", { name: "ERP", scopes: ["checks:write"], expiresInDays: 30 }, { maxActive: 5 });
    const next = await keys.rotate("o", old.record.id, { maxActive: 5 });
    expect(next.record).toMatchObject({ name: "ERP", scopes: ["checks:write"], rotatedFromId: old.record.id });
    expect(next.key).not.toBe(old.key);
    expect((await keys.authenticate(bearer(old.key), "checks:write")).ok).toBe(true);
    advance(25 * HOUR);
    expect(await keys.authenticate(bearer(old.key), "checks:write")).toMatchObject({
      ok: false,
      code: "API_KEY_SUPERSEDED",
    });
    expect((await keys.authenticate(bearer(next.key), "checks:write")).ok).toBe(true);
  });

  it("only the owner can list, rotate or revoke a key; the others get « not found »", async () => {
    const { keys } = setup();
    const { record } = await keys.create(
      "owner-1",
      { name: "k", scopes: ["checks:write"], expiresInDays: 30 },
      { maxActive: 5 },
    );
    expect(await keys.list("owner-2")).toEqual([]);
    await expect(keys.revoke("owner-2", record.id)).rejects.toMatchObject({ code: "API_KEY_NOT_FOUND" });
    await expect(keys.rotate("owner-2", record.id, { maxActive: 5 })).rejects.toMatchObject({
      code: "API_KEY_NOT_FOUND",
    });
    expect((await keys.list("owner-1")).map((k) => k.id)).toEqual([record.id]);
  });

  it("a revoked key cannot be rotated, and revoking twice is fine", async () => {
    const { keys } = setup();
    const { record } = await keys.create(
      "o",
      { name: "k", scopes: ["checks:write"], expiresInDays: 30 },
      { maxActive: 5 },
    );
    await keys.revoke("o", record.id);
    await keys.revoke("o", record.id);
    await expect(keys.rotate("o", record.id, { maxActive: 5 })).rejects.toMatchObject({ code: "API_KEY_REVOKED" });
  });

  it("a revoked or expired key does not count against the plan's limit", async () => {
    const { keys } = setup();
    const a = await keys.create("o", { name: "a", scopes: ["checks:write"], expiresInDays: 30 }, { maxActive: 1 });
    await keys.revoke("o", a.record.id);
    await expect(
      keys.create("o", { name: "b", scopes: ["checks:write"], expiresInDays: 30 }, { maxActive: 1 }),
    ).resolves.toBeTruthy();
  });
});
