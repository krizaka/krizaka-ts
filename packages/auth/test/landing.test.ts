import { describe, expect, it } from "vitest";

import { landingRedirect, SESSION_HINT_COOKIE, sessionHint } from "../src/landing";

const rule = { cookie: "yomizaka_session", landing: ["/", "/fr", "/en"], home: "/app" } as const;
const at = (path: string, cookie?: string, method = "GET") => new Request(`https://www.example.com${path}`, { method, headers: cookie ? { cookie } : {} });

describe("landingRedirect: a signed-in visitor never sees the public landing page", () => {
  it("307 to the home, private and varying with the cookie, when the session cookie is there", () => {
    const res = landingRedirect(at("/", "a=1; yomizaka_session=ys1.x"), rule);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe("https://www.example.com/app");
    expect(res?.headers.get("cache-control")).toBe("private, no-store");
    expect(res?.headers.get("vary")).toBe("Cookie");
  });
  it("covers each landing route, with or without a trailing slash", () => {
    for (const path of ["/fr", "/fr/", "/en"]) expect(landingRedirect(at(path, "yomizaka_session=t"), rule)?.status).toBe(307);
  });
  it("lets a signed-out visitor through, and every other page", () => {
    expect(landingRedirect(at("/"), rule)).toBeNull();
    expect(landingRedirect(at("/", "other=1"), rule)).toBeNull();
    expect(landingRedirect(at("/pricing", "yomizaka_session=t"), rule)).toBeNull();
    expect(landingRedirect(at("/", "yomizaka_session="), rule)).toBeNull();
  });
  it("only redirects a page read (GET, HEAD)", () => {
    expect(landingRedirect(at("/", "yomizaka_session=t", "POST"), rule)).toBeNull();
    expect(landingRedirect(at("/", "yomizaka_session=t", "HEAD"), rule)?.status).toBe(307);
  });
  it("the home may depend on the request (the language of the address)", () => {
    const res = landingRedirect(at("/fr", "yomizaka_session=t"), { ...rule, home: (r) => `${new URL(r.url).pathname}/app` });
    expect(res?.headers.get("location")).toBe("https://www.example.com/fr/app");
  });
});

describe("sessionHint: a readable « a session cookie exists » flag, never the token", () => {
  const set = (res: Response) => res.headers.get("set-cookie") ?? "";
  it("sets the flag when the session cookie is there and the flag is not", () => {
    const out = set(sessionHint(new Response(null), at("/pricing", "yomizaka_session=ys1.secret"), { cookie: "yomizaka_session", secure: true }));
    expect(out).toContain(`${SESSION_HINT_COOKIE}=1`);
    expect(out).not.toContain("ys1.secret");
    expect(out).not.toMatch(/httponly/i);
    expect(out).toMatch(/samesite=lax/i);
    expect(out).toMatch(/secure/i);
  });
  it("clears it when the session cookie is gone", () => {
    expect(set(sessionHint(new Response(null), at("/", `${SESSION_HINT_COOKIE}=1`), { cookie: "yomizaka_session", secure: false }))).toMatch(/max-age=0/i);
  });
  it("touches nothing when flag and cookie agree", () => {
    expect(set(sessionHint(new Response(null), at("/", `yomizaka_session=t; ${SESSION_HINT_COOKIE}=1`), { cookie: "yomizaka_session", secure: false }))).toBe("");
    expect(set(sessionHint(new Response(null), at("/"), { cookie: "yomizaka_session", secure: false }))).toBe("");
  });
});
