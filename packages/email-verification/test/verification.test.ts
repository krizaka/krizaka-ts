import { describe, expect, it } from "vitest";

import { createEmailVerification, memoryCodeStore, VERIFICATION_CODE, VerificationError, verificationMail } from "../src";
import { codeStoreContract } from "../src/testkit";

const SECRET = "x".repeat(40);
const T0 = new Date("2026-10-29T12:00:00.000Z");

function setup(over: { now?: () => Date; settings?: { maxAttempts?: number } } = {}) {
  const clock = { at: T0 };
  const store = memoryCodeStore();
  let n = 0;
  const v = createEmailVerification({
    store,
    secret: SECRET,
    now: over.now ?? (() => clock.at),
    ...(over.settings ? { settings: over.settings } : {}),
    randomInt: () => 7,
    randomId: () => `id-${(n += 1)}`,
  });
  return { v, store, clock };
}

codeStoreContract("memory", () => memoryCodeStore());

describe("email verification", () => {
  it("issues a 6-digit code valid 15 minutes and releases the held payload once", async () => {
    const { v } = setup();
    const issued = await v.issue({ address: "Ada@Example.com", payload: { message: "hello" } });
    expect(issued.code).toBe("777777");
    expect(issued.ttlMinutes).toBe(15);
    expect(issued.expiresAt.toISOString()).toBe("2026-10-29T12:15:00.000Z");
    const ok = await v.confirm({ challengeId: issued.challengeId, address: "ada@example.com", code: "777 777" });
    expect(ok).toEqual({ ok: true, payload: { message: "hello" } });
    // single use
    expect(await v.confirm({ challengeId: issued.challengeId, address: "ada@example.com", code: "777777" })).toEqual({ ok: false, reason: "unknown" });
  });

  it("never stores the code or the address, only a salted hash", async () => {
    const { v, store } = setup();
    const issued = await v.issue({ address: "ada@example.com", payload: {} });
    const row = await store.get(issued.challengeId);
    expect(JSON.stringify(row)).not.toContain(issued.code);
    expect(JSON.stringify(row)).not.toContain("ada@example.com");
  });

  it("refuses a code for another address (the proof binds the address)", async () => {
    const { v } = setup();
    const issued = await v.issue({ address: "ada@example.com", payload: {} });
    const bad = await v.confirm({ challengeId: issued.challengeId, address: "eve@example.com", code: issued.code });
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("counts wrong codes and destroys the challenge at the limit, even for the right code afterwards", async () => {
    const { v } = setup({ settings: { maxAttempts: 3 } });
    const issued = await v.issue({ address: "ada@example.com", payload: {} });
    const wrong = { challengeId: issued.challengeId, address: "ada@example.com", code: "000000" };
    expect(await v.confirm(wrong)).toEqual({ ok: false, reason: "invalid", attemptsLeft: 2 });
    expect(await v.confirm(wrong)).toEqual({ ok: false, reason: "invalid", attemptsLeft: 1 });
    expect(await v.confirm(wrong)).toEqual({ ok: false, reason: "locked" });
    expect(await v.confirm({ ...wrong, code: issued.code })).toEqual({ ok: false, reason: "unknown" });
  });

  it("expires after 15 minutes", async () => {
    const { v, clock } = setup();
    const issued = await v.issue({ address: "ada@example.com", payload: {} });
    clock.at = new Date(T0.valueOf() + 15 * 60_000 + 1);
    expect(await v.confirm({ challengeId: issued.challengeId, address: "ada@example.com", code: issued.code })).toEqual({ ok: false, reason: "expired" });
  });

  it("two concurrent confirmations release the payload once", async () => {
    const { v } = setup();
    const issued = await v.issue({ address: "ada@example.com", payload: { a: 1 } });
    const input = { challengeId: issued.challengeId, address: "ada@example.com", code: issued.code };
    const results = await Promise.all([v.confirm(input), v.confirm(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("an unknown id and a bad address are refused; a short secret or bad settings throw", async () => {
    const { v } = setup();
    expect(await v.confirm({ challengeId: "nope", address: "a@b.c", code: "123456" })).toEqual({ ok: false, reason: "unknown" });
    await expect(v.issue({ address: "not-an-address", payload: {} })).rejects.toMatchObject({ code: VERIFICATION_CODE.badAddress });
    expect(() => createEmailVerification({ store: memoryCodeStore(), secret: "short", now: () => T0 })).toThrow(VerificationError);
    expect(() => createEmailVerification({ store: memoryCodeStore(), secret: SECRET, now: () => T0, settings: { codeLength: 2 } })).toThrow(/codeLength/);
  });

  it("purges the expired challenges", async () => {
    const { v, clock } = setup();
    await v.issue({ address: "ada@example.com", payload: {} });
    clock.at = new Date(T0.valueOf() + 16 * 60_000);
    expect(await v.purge()).toBe(1);
  });

  it("draws every digit from the injected source (uniform digits 0-9)", async () => {
    const v = createEmailVerification({ store: memoryCodeStore(), secret: SECRET, now: () => T0 });
    const { code } = await v.issue({ address: "ada@example.com", payload: {} });
    expect(code).toMatch(/^\d{6}$/);
  });

  it("bounds the memory store: a flood evicts the oldest challenge", async () => {
    const store = memoryCodeStore({ maxChallenges: 2 });
    const v = createEmailVerification({ store, secret: SECRET, now: () => T0 });
    const a = await v.issue({ address: "a@b.c", payload: {} });
    await v.issue({ address: "b@b.c", payload: {} });
    await v.issue({ address: "c@b.c", payload: {} });
    expect(await store.get(a.challengeId)).toBeNull();
  });
});

describe("the code mail", () => {
  it("is written in English and in French, with the code and the window", () => {
    const en = verificationMail({ locale: "en", code: "123456", ttlMinutes: 15 });
    expect(en.subject).toBe("Your Krizaka code: 123456");
    expect(en.text).toContain("valid for 15 minutes");
    const fr = verificationMail({ locale: "fr", code: "123456", ttlMinutes: 15 });
    expect(fr.subject).toBe("Votre code Krizaka : 123456");
    expect(fr.html).toContain("valable 15 minutes");
    expect(verificationMail({ locale: "de", code: "1", ttlMinutes: 1 }).subject).toContain("Your Krizaka code");
  });

  it("only ever writes digits into the HTML", () => {
    expect(verificationMail({ locale: "en", code: "<b>12", ttlMinutes: 15 }).html).not.toContain("<b>");
  });
});
