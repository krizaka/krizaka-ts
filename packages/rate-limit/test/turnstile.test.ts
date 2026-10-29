import { describe, expect, it } from "vitest";

import { createTurnstileVerifier, TURNSTILE_SITEVERIFY_URL, type TurnstileFetch } from "../src/turnstile";

const NOW = new Date("2026-10-29T12:00:00.000Z");

/** A fake siteverify: records the calls and answers what the test says. */
function fake(answer: unknown, ok = true) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetch: TurnstileFetch = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    return { ok, json: async () => answer };
  };
  return { calls, fetch };
}
const verifier = (f: ReturnType<typeof fake>, over: Partial<Parameters<typeof createTurnstileVerifier>[0]> = {}, clock = { at: NOW }) =>
  createTurnstileVerifier({ secret: "s3cret", now: () => clock.at, fetch: f.fetch, ...over });

describe("verifyTurnstile", () => {
  it("passes a token Cloudflare accepts, posting the secret, token and address", async () => {
    const f = fake({ success: true, hostname: "www.krizaka.com", action: "contact" });
    const result = await verifier(f, { hostnames: ["www.krizaka.com"] })({ token: "tok", remoteIp: "1.2.3.4", action: "contact" });
    expect(result).toEqual({ ok: true });
    expect(f.calls[0]?.url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(Object.fromEntries(f.calls[0]!.body)).toEqual({ secret: "s3cret", response: "tok", remoteip: "1.2.3.4" });
  });

  it("fails closed with no secret, and never calls Cloudflare", async () => {
    const f = fake({ success: true });
    for (const secret of [undefined, "", "  "]) expect(await verifier(f, { secret })({ token: "tok" })).toMatchObject({ ok: false, reason: "not-configured" });
    expect(f.calls).toHaveLength(0);
  });

  it("fails closed with a missing, blank, non-string or oversized token, without calling Cloudflare", async () => {
    const f = fake({ success: true });
    const v = verifier(f);
    for (const token of [undefined, "", "  ", 42, "x".repeat(2049)]) expect(await v({ token })).toMatchObject({ ok: false, reason: "missing-token" });
    expect(f.calls).toHaveLength(0);
  });

  it("refuses a token Cloudflare rejects, with its error codes", async () => {
    const f = fake({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifier(f)({ token: "bad" })).toEqual({ ok: false, reason: "rejected", errorCodes: ["invalid-input-response"] });
  });

  it("refuses a token solved on another hostname or for another action", async () => {
    const f = fake({ success: true, hostname: "evil.example", action: "subscribe" });
    expect(await verifier(f, { hostnames: ["www.krizaka.com"] })({ token: "t1" })).toMatchObject({ reason: "hostname" });
    const g = fake({ success: true, hostname: "www.krizaka.com", action: "subscribe" });
    expect(await verifier(g, { hostnames: ["www.krizaka.com"] })({ token: "t2", action: "contact" })).toMatchObject({ reason: "action" });
  });

  it("is single-use: the same token is refused the second time, and forgotten after its 300 s", async () => {
    const f = fake({ success: true });
    const clock = { at: NOW };
    const v = verifier(f, {}, clock);
    expect(await v({ token: "once" })).toEqual({ ok: true });
    expect(await v({ token: "once" })).toMatchObject({ ok: false, reason: "replayed" });
    expect(f.calls).toHaveLength(1);
    clock.at = new Date(NOW.valueOf() + 301_000);
    expect(await v({ token: "once" })).toEqual({ ok: true });
  });

  it("fails closed when Cloudflare is down, errors or times out", async () => {
    expect(await verifier(fake({}, false))({ token: "a" })).toMatchObject({ reason: "unavailable" });
    const throwing: TurnstileFetch = async () => {
      throw new Error("network");
    };
    expect(await createTurnstileVerifier({ secret: "s", now: () => NOW, fetch: throwing })({ token: "b" })).toMatchObject({ reason: "unavailable" });
    const hang: TurnstileFetch = (_u, init) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("timeout"))));
    expect(await createTurnstileVerifier({ secret: "s", now: () => NOW, fetch: hang, timeoutMs: 20 })({ token: "c" })).toMatchObject({ reason: "unavailable" });
  });
});
