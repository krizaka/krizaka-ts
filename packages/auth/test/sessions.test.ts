import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  clearedSessionCookie,
  createSessions,
  dbSessionStore,
  memorySessionStore,
  sessionCookie,
  sessionTokenOf,
} from "../src";
import { sessionStoreContract } from "../src/testkit";

interface Account {
  id: string;
  role: "USER" | "ADMIN";
}

const KEY = "s".repeat(32);
const NOW = new Date("2026-10-26T12:00:00Z");

function setup(over: { days?: number | (() => number | Promise<number>); now?: () => Date; active?: boolean } = {}) {
  const accounts = new Map<string, Account & { active: boolean }>([
    ["a1", { id: "a1", role: "USER", active: over.active ?? true }],
  ]);
  const store = memorySessionStore<Account>((id) => {
    const found = accounts.get(id);
    return found?.active ? { id: found.id, role: found.role } : null;
  });
  const clock = { now: over.now ?? (() => NOW) };
  const sessions = createSessions<Account>({
    store,
    clock,
    tokenPrefix: "ys",
    secret: KEY,
    sessionDays: over.days ?? 14,
  });
  return { sessions, store, accounts };
}

describe("session tokens", () => {
  it("are random, shaped `<prefix>1.<43 characters>`, and kept only as a keyed hash", () => {
    const { sessions } = setup();
    const a = sessions.newToken();
    expect(a).toMatch(/^ys1\.[A-Za-z0-9_-]{43}$/);
    expect(sessions.isToken(a)).toBe(true);
    expect(a).not.toBe(sessions.newToken());
    for (const bad of [
      undefined,
      "",
      "ys1.short",
      "as1." + "A".repeat(43),
      "ys1." + "A".repeat(44),
      "ys2." + "A".repeat(43),
    ])
      expect(sessions.isToken(bad), String(bad)).toBe(false);
    expect(sessions.tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash as the products' copies did (HMAC-SHA256 keyed `session:<key>`), so the sessions already stored keep working", () => {
    const token = `ys1.${"A".repeat(43)}`;
    const { sessions } = setup();
    // recorded from Yomizaka's `tokenHash(token, "s".repeat(32))`
    expect(sessions.tokenHash(token)).toBe("7105d1fcb40076d40fa5507585d53aa46c1286435d724a7d9ea55b7a46188924");
    expect(sessions.tokenHash(token)).toBe(crypto.createHmac("sha256", `session:${KEY}`).update(token).digest("hex"));
    const other = createSessions<Account>({
      store: memorySessionStore<Account>(() => null),
      clock: { now: () => NOW },
      tokenPrefix: "ys",
      secret: () => "t".repeat(32),
      sessionDays: 14,
    });
    expect(other.tokenHash(token)).not.toBe(sessions.tokenHash(token));
  });

  it("refuse a prefix that would break the shape", () => {
    for (const tokenPrefix of ["", "Y", "ys1", "toolong", "y."])
      expect(
        () =>
          createSessions<Account>({
            store: memorySessionStore<Account>(() => null),
            clock: { now: () => NOW },
            tokenPrefix,
            secret: KEY,
            sessionDays: 14,
          }),
        tokenPrefix,
      ).toThrow(RangeError);
  });
});

describe("opening, resolving and ending a session", () => {
  it("opens a session that lasts the setting's days from the clock, and keeps only the hash", async () => {
    const { sessions, store } = setup({ days: 14 });
    const { token, expires } = await sessions.create("a1", { ip: "203.0.113.7", userAgent: "x".repeat(400) });
    expect(sessions.isToken(token)).toBe(true);
    expect(expires.toISOString()).toBe("2026-11-09T12:00:00.000Z");
    const [row] = store.rows();
    expect(row).toMatchObject({ accountId: "a1", tokenHash: sessions.tokenHash(token), ip: "203.0.113.7" });
    expect(row!.userAgent).toHaveLength(300);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("reads the lifetime from the setting each time, so the admin's change applies to the next sign-in", async () => {
    let days = 14;
    const { sessions } = setup({ days: () => days });
    expect((await sessions.create("a1", { ip: null, userAgent: null })).expires.toISOString()).toBe(
      "2026-11-09T12:00:00.000Z",
    );
    days = 1;
    expect((await sessions.create("a1", { ip: null, userAgent: null })).expires.toISOString()).toBe(
      "2026-10-27T12:00:00.000Z",
    );
    const later = setup({ days: async () => 7 });
    expect((await later.sessions.create("a1", { ip: null, userAgent: null })).expires.toISOString()).toBe(
      "2026-11-02T12:00:00.000Z",
    );
  });

  it("refuses a lifetime that is not a whole number of days from 1", async () => {
    for (const days of [0, -3, 1.5, Number.NaN])
      await expect(setup({ days }).sessions.create("a1", { ip: null, userAgent: null })).rejects.toThrow(RangeError);
  });

  it("resolves a token to its session and account, and nothing for a bad, unknown or revoked one", async () => {
    const { sessions } = setup();
    const { token } = await sessions.create("a1", { ip: null, userAgent: null });
    expect(await sessions.resolve(token)).toMatchObject({ account: { id: "a1", role: "USER" } });
    expect(await sessions.resolve(undefined)).toBeNull();
    expect(await sessions.resolve("garbage")).toBeNull();
    expect(await sessions.resolve(sessions.newToken())).toBeNull();
    await sessions.revoke(token);
    expect(await sessions.resolve(token)).toBeNull();
    await sessions.revoke("garbage"); // ignored
    await sessions.revoke(undefined);
  });

  it("expires by the clock: the session is gone when its time is up", async () => {
    let now = NOW;
    const { sessions } = setup({ days: 1, now: () => now });
    const { token } = await sessions.create("a1", { ip: null, userAgent: null });
    now = new Date("2026-10-27T11:59:59Z");
    expect(await sessions.resolve(token)).not.toBeNull();
    now = new Date("2026-10-27T12:00:00Z");
    expect(await sessions.resolve(token)).toBeNull();
  });

  it("signs nobody in for an account that is no longer active (a suspension applies at once)", async () => {
    const { sessions, accounts } = setup();
    const { token } = await sessions.create("a1", { ip: null, userAgent: null });
    accounts.get("a1")!.active = false;
    expect(await sessions.resolve(token)).toBeNull();
  });
});

describe("the cookie", () => {
  const expires = new Date("2026-11-09T12:00:00Z");
  it("is HttpOnly, SameSite=Lax, on the whole site, Secure where the product says", () => {
    expect(sessionCookie("t", expires, { name: "yomizaka_session", secure: true })).toEqual({
      name: "yomizaka_session",
      value: "t",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
    expect(sessionCookie("t", expires, { name: "x", secure: false }).secure).toBe(false);
  });
  it("is cleared by an empty value that expires now", () => {
    expect(clearedSessionCookie({ name: "x", secure: true }, NOW)).toMatchObject({ value: "", expires: NOW });
  });
});

describe("the session token of a request", () => {
  const token = `ys1.${"B".repeat(43)}`;
  const web = { cookie: "yomizaka_session" };
  it("reads the cookie of the web", () => {
    expect(sessionTokenOf(new Headers({ cookie: `a=b; yomizaka_session=${token}` }), web)).toBe(token);
  });
  it("reads the bearer of a native app, and prefers it to a stale cookie", () => {
    expect(sessionTokenOf(new Headers({ authorization: `Bearer ${token}` }), web)).toBe(token);
    expect(
      sessionTokenOf(
        new Headers({ authorization: `bearer ${token}`, cookie: `yomizaka_session=ys1.${"C".repeat(43)}` }),
        web,
      ),
    ).toBe(token);
  });
  it("ignores the bearer for a product with no native app", () => {
    expect(
      sessionTokenOf(new Headers({ authorization: `Bearer ${token}` }), { ...web, bearer: false }),
    ).toBeUndefined();
    expect(
      sessionTokenOf(new Headers({ authorization: `Bearer ${token}`, cookie: `yomizaka_session=${token}` }), {
        ...web,
        bearer: false,
      }),
    ).toBe(token);
  });
  it.each([[new Headers()], [new Headers({ authorization: "Basic abc" })], [new Headers({ cookie: "other=1" })]])(
    "answers nothing without a session",
    (headers) => {
      expect(sessionTokenOf(headers, web)).toBeUndefined();
    },
  );
});

describe("the memory store", () => {
  sessionStoreContract("memory", () => {
    const suspended = new Set<string>();
    return {
      store: memorySessionStore((id) => (suspended.has(id) ? null : { id })),
      account: (n) => `account-${n}`,
      suspend: (id) => void suspended.add(id),
    };
  });
});

describe("the database store's names", () => {
  const query = async () => [];
  it("refuses an unsafe table or column name, so nothing but identifiers reaches SQL", () => {
    expect(() =>
      dbSessionStore(query, { sessions: "sessions; DROP TABLE x", columns: ["id"], toAccount: () => ({}) }),
    ).toThrow(/DB_UNSAFE_IDENTIFIER/);
    expect(() => dbSessionStore(query, { accounts: "Accounts", columns: ["id"], toAccount: () => ({}) })).toThrow(
      /DB_UNSAFE_IDENTIFIER/,
    );
    expect(() => dbSessionStore(query, { columns: ["id, (select 1)"], toAccount: () => ({}) })).toThrow(
      /DB_UNSAFE_IDENTIFIER/,
    );
    expect(() =>
      dbSessionStore(query, {
        columns: ["id"],
        toAccount: () => ({}),
        active: { column: "status; --", equals: "ACTIVE" },
      }),
    ).toThrow(/DB_UNSAFE_IDENTIFIER/);
  });

  it("selects the session with its account columns and compares the expiry with the clock's now", async () => {
    const calls: { sql: string; params: unknown[] | undefined }[] = [];
    const recording = async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return [{ session_id: "s1", id: "a1", role: "ADMIN" }];
    };
    const store = dbSessionStore<Account>(recording as never, {
      columns: ["id", "role"],
      toAccount: (row) => ({ id: String(row.id), role: row.role as Account["role"] }),
      active: { column: "status", equals: "ACTIVE" },
    });
    const now = new Date("2026-10-26T12:00:00Z");
    expect(await store.find("hash", now)).toEqual({ id: "s1", account: { id: "a1", role: "ADMIN" } });
    expect(calls[0]!.sql).toBe(
      "SELECT s.id AS session_id, a.id, a.role FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > $2 AND a.status = $3",
    );
    expect(calls[0]!.params).toEqual(["hash", now, "ACTIVE"]);
  });
});
