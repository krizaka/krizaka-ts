import { describe, expect, it } from "vitest";

import { createLimiter, memoryLimitStore, RATE_LIMIT_CODE, RateLimited } from "../src";
import { limitStoreContract } from "../src/testkit";

const BASE = new Date("2026-10-26T12:00:00.000Z");
const later = (ms: number) => new Date(BASE.valueOf() + ms);

function setup(limits: Parameters<typeof createLimiter>[0]["limits"], over: { maxKeys?: number } = {}) {
  let now = BASE;
  const store = memoryLimitStore(over);
  const limiter = createLimiter({ store, clock: { now: () => now }, limits });
  return { limiter, store, at: (date: Date) => void (now = date) };
}

/** The copies' tests (Yomizaka and Akinaza `rate-limit`, byte-identical), carried over: same numbers, same answers. */
describe("the copies' behaviour", () => {
  it("allows the limit, then refuses with Retry-After until the window ends", async () => {
    const { limiter, at } = setup({ k: { perIp: 2, windowSeconds: 60 } });
    expect((await limiter.check("k", { ip: "203.0.113.7" })).ok).toBe(true);
    expect((await limiter.check("k", { ip: "203.0.113.7" })).ok).toBe(true);
    at(later(1000));
    expect(await limiter.check("k", { ip: "203.0.113.7" })).toEqual({ ok: false, retryAfterSeconds: 59, scope: "ip" });
    at(later(61_000));
    expect((await limiter.check("k", { ip: "203.0.113.7" })).ok).toBe(true);
  });

  it("counts per address and per subject: a refusal is a 429 that carries its code and Retry-After", async () => {
    const { limiter } = setup({ "sign-in": { perIp: 10, perSubject: 1, windowSeconds: 60 } });
    await limiter.enforce("sign-in", { ip: "203.0.113.7", subject: "a@b.c" });
    const error = await limiter.enforce("sign-in", { ip: "203.0.113.7", subject: "A@B.C" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimited);
    expect(error).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      scope: "subject",
      retryAfterSeconds: 60,
      headers: { "Retry-After": "60" },
    });
  });

  it("counts a refused hit too, as the copies did", async () => {
    const { limiter, at } = setup({ k: { perIp: 1, windowSeconds: 60 } });
    await limiter.check("k", { ip: "1.1.1.1" });
    await limiter.check("k", { ip: "1.1.1.1" }); // refused, counted
    at(later(59_000));
    expect((await limiter.check("k", { ip: "1.1.1.1" })).ok).toBe(false);
  });

  it("counts an unknown address under `unknown`, and keeps actions apart", async () => {
    const { limiter } = setup({ a: { perIp: 1, windowSeconds: 60 }, b: { perIp: 1, windowSeconds: 60 } });
    expect((await limiter.check("a", { ip: null })).ok).toBe(true);
    expect((await limiter.check("a", {})).ok).toBe(false);
    expect((await limiter.check("b", { ip: null })).ok).toBe(true);
  });

  it("reads the address first and stops at its refusal: the subject is not counted then", async () => {
    const { limiter, store } = setup({ k: { perIp: 1, perSubject: 5, windowSeconds: 60 } });
    await limiter.check("k", { ip: "1.1.1.1", subject: "x@y.z" });
    expect(await limiter.check("k", { ip: "1.1.1.1", subject: "x@y.z" })).toMatchObject({ ok: false, scope: "ip" });
    expect((await store.peek("k:s:x@y.z", BASE))?.count).toBe(1);
  });

  it("counts the subject only when the action limits it and one is given", async () => {
    const { limiter, store } = setup({
      onlyIp: { perIp: 5, windowSeconds: 60 },
      both: { perIp: 5, perSubject: 5, windowSeconds: 60 },
    });
    await limiter.check("onlyIp", { ip: "1.1.1.1", subject: "x@y.z" });
    await limiter.check("both", { ip: "1.1.1.1", subject: null });
    expect(await store.peek("onlyIp:s:x@y.z", BASE)).toBeNull();
    expect(await store.peek("both:s:null", BASE)).toBeNull();
  });
});

describe("the memory store's bound", () => {
  it("drops the ended windows first, and when still full gives new keys one shared overflow window: nobody's live count is cleared", async () => {
    const { limiter, store, at } = setup({ k: { perIp: 1, windowSeconds: 60 } }, { maxKeys: 2 });
    await limiter.check("k", { ip: "1.1.1.1" });
    await limiter.check("k", { ip: "2.2.2.2" });
    expect((await limiter.check("k", { ip: "3.3.3.3" })).ok).toBe(true); // the overflow window, 1st hit
    expect((await limiter.check("k", { ip: "4.4.4.4" })).ok).toBe(false); // shares it: a flood limits itself
    expect((await limiter.check("k", { ip: "1.1.1.1" })).ok).toBe(false); // a live count is untouched
    at(later(61_000));
    expect((await limiter.check("k", { ip: "5.5.5.5" })).ok).toBe(true); // ended windows made room
    expect(await store.purge(later(200_000))).toBeGreaterThan(0);
  });
});

describe("the limits", () => {
  it("come from a function at each check, so a setting changed by the admin applies at once", async () => {
    let perIp = 1;
    const { limiter } = setup(async () => ({ perIp, windowSeconds: 60 }));
    await limiter.check("k", { ip: "1.1.1.1" });
    expect((await limiter.check("k", { ip: "1.1.1.1" })).ok).toBe(false);
    perIp = 5;
    expect((await limiter.check("k", { ip: "1.1.1.1" })).ok).toBe(true);
  });

  it("refuse to run without limits for the action, or with limits that are not whole numbers from 1", async () => {
    const { limiter } = setup({
      ok: { perIp: 1, windowSeconds: 60 },
      zero: { perIp: 0, windowSeconds: 60 },
      fraction: { perSubject: 1.5, windowSeconds: 60 },
      noWindow: { perIp: 1, windowSeconds: 0 },
    });
    await expect(limiter.check("missing", { ip: "1.1.1.1" })).rejects.toThrow(RATE_LIMIT_CODE.noLimits);
    for (const action of ["zero", "fraction", "noWindow"])
      await expect(limiter.check(action, { ip: "1.1.1.1" })).rejects.toThrow(RATE_LIMIT_CODE.badLimit);
  });
});

describe("forgetting", () => {
  it("clears the action's counters of these keys: a successful sign-in clears its failures", async () => {
    const { limiter } = setup({ signIn: { perIp: 1, perSubject: 1, windowSeconds: 60 } });
    await limiter.check("signIn", { ip: "1.1.1.1", subject: "a@b.c" });
    expect((await limiter.check("signIn", { ip: "1.1.1.1", subject: "a@b.c" })).ok).toBe(false);
    await limiter.forget("signIn", { ip: "1.1.1.1", subject: "A@b.c" });
    expect((await limiter.check("signIn", { ip: "1.1.1.1", subject: "a@b.c" })).ok).toBe(true);
  });
});

describe("a store that fails", () => {
  const broken = (): ReturnType<typeof memoryLimitStore> => ({
    ...memoryLimitStore(),
    hit: async () => Promise.reject(new Error("db down")),
  });

  it("lets the request through by default, and tells onStoreError", async () => {
    const heard: unknown[] = [];
    const limiter = createLimiter({
      store: broken(),
      clock: { now: () => BASE },
      limits: { k: { perIp: 1, windowSeconds: 60 } },
      onStoreError: (error, action) => heard.push([String(error), action]),
    });
    expect(await limiter.check("k", { ip: "1.1.1.1" })).toEqual({ ok: true });
    expect(heard).toEqual([["Error: db down", "k"]]);
  });

  it("refuses by rethrowing when told to fail closed", async () => {
    const limiter = createLimiter({
      store: broken(),
      clock: { now: () => BASE },
      limits: { k: { perIp: 1, windowSeconds: 60 } },
      failOpen: false,
    });
    await expect(limiter.check("k", { ip: "1.1.1.1" })).rejects.toThrow("db down");
  });
});

describe("the memory store", () => {
  limitStoreContract("memory", () => memoryLimitStore());
});
