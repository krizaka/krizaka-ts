import { describe, expect, it } from "vitest";

import { landingRedirect, SESSION_HINT_COOKIE, sessionHint } from "../src/landing";

const rule = { cookie: "yomizaka_session", landing: ["/", "/fr", "/en"], home: "/app" } as const;
const at = (path: string, cookie?: string, method = "GET") =>
  new Request(`https://www.example.com${path}`, { method, headers: cookie ? { cookie } : {} });

describe("landingRedirect: a signed-in visitor never sees the public landing page", () => {
  it("307 to the home, private and varying with the cookie, when the session cookie is there", () => {
    const res = landingRedirect(at("/", "a=1; yomizaka_session=ys1.x"), rule);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe("/app");
    expect(res?.headers.get("cache-control")).toBe("private, no-store");
    expect(res?.headers.get("vary")).toBe("Cookie");
  });
  it("the Location is relative: the browser keeps the origin it asked for, whatever scheme the proxy saw", () => {
    const internal = new Request("https://localhost:3000/fr?x=1", { headers: { cookie: "yomizaka_session=t" } });
    expect(landingRedirect(internal, { ...rule, home: "/fr/app?from=landing" })?.headers.get("location")).toBe(
      "/fr/app?from=landing",
    );
  });
  it("with a configured origin the Location is absolute on it, and a spoofed Host or forwarded header never changes it", () => {
    const spoof = new Request("https://evil.example/fr", {
      headers: {
        cookie: "yomizaka_session=t",
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
      },
    });
    const res = landingRedirect(spoof, {
      ...rule,
      home: "/fr/app?from=landing",
      origin: "https://dev.yomizaka.com/ignored/path",
    });
    expect(res?.headers.get("location")).toBe("https://dev.yomizaka.com/fr/app?from=landing");
  });
  it("a home that would leave the configured origin falls back to a relative path", () => {
    const res = landingRedirect(at("/", "yomizaka_session=t"), {
      ...rule,
      home: "//evil.example/x",
      origin: "https://dev.yomizaka.com",
    });
    expect(res?.headers.get("location")).toBe("/x");
  });
  it("the absolute Location is accepted by the URL parser of a Next.js proxy", () => {
    const res = landingRedirect(at("/", "yomizaka_session=t"), { ...rule, origin: "https://dev.yomizaka.com" });
    expect(() => new URL(res?.headers.get("location") ?? "")).not.toThrow();
  });
  it("covers each landing route, with or without a trailing slash", () => {
    for (const path of ["/fr", "/fr/", "/en"])
      expect(landingRedirect(at(path, "yomizaka_session=t"), rule)?.status).toBe(307);
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
    const res = landingRedirect(at("/fr", "yomizaka_session=t"), {
      ...rule,
      home: (r) => `${new URL(r.url).pathname}/app`,
    });
    expect(res?.headers.get("location")).toBe("/fr/app");
  });
});

describe("sessionHint: a readable « a session cookie exists » flag, never the token", () => {
  const set = (res: Response) => res.headers.get("set-cookie") ?? "";
  it("sets the flag when the session cookie is there and the flag is not", () => {
    const out = set(
      sessionHint(new Response(null), at("/pricing", "yomizaka_session=ys1.secret"), {
        cookie: "yomizaka_session",
        secure: true,
      }),
    );
    expect(out).toContain(`${SESSION_HINT_COOKIE}=1`);
    expect(out).not.toContain("ys1.secret");
    expect(out).not.toMatch(/httponly/i);
    expect(out).toMatch(/samesite=lax/i);
    expect(out).toMatch(/secure/i);
  });
  it("clears it when the session cookie is gone", () => {
    expect(
      set(
        sessionHint(new Response(null), at("/", `${SESSION_HINT_COOKIE}=1`), {
          cookie: "yomizaka_session",
          secure: false,
        }),
      ),
    ).toMatch(/max-age=0/i);
  });
  it("touches nothing when flag and cookie agree", () => {
    expect(
      set(
        sessionHint(new Response(null), at("/", `yomizaka_session=t; ${SESSION_HINT_COOKIE}=1`), {
          cookie: "yomizaka_session",
          secure: false,
        }),
      ),
    ).toBe("");
    expect(set(sessionHint(new Response(null), at("/"), { cookie: "yomizaka_session", secure: false }))).toBe("");
  });
});

describe("landingRedirect on hostile paths", () => {
  it("matches a path of many slashes in linear time (no polynomial regular expression)", () => {
    const started = performance.now();
    expect(landingRedirect(at(`/${"/".repeat(50_000)}x`, "yomizaka_session=t"), rule)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
    expect(landingRedirect(at("/fr///", "yomizaka_session=t"), rule)?.status).toBe(307);
  });
});

describe("landingRedirect in production without a configured origin fails loudly", () => {
  const inProduction = async (run: () => void) => {
    const { vi } = await import("vitest");
    vi.stubEnv("NODE_ENV", "production");
    try {
      run();
    } finally {
      vi.unstubAllEnvs();
    }
  };
  it("throws on every request (even a signed-out one) rather than falling back to the request's headers", async () => {
    await inProduction(() => {
      expect(() => landingRedirect(at("/", "yomizaka_session=t"), rule)).toThrow(/origin/);
      expect(() => landingRedirect(at("/pricing"), rule)).toThrow(/origin/);
      expect(() => landingRedirect(at("/", "yomizaka_session=t"), { ...rule, origin: "" })).toThrow(/origin/);
    });
  });
  it("works with an origin in production", async () => {
    await inProduction(() => {
      expect(
        landingRedirect(at("/", "yomizaka_session=t"), { ...rule, origin: "https://dev.example.com" })?.headers.get(
          "location",
        ),
      ).toBe("https://dev.example.com/app");
    });
  });
  it("stays optional outside production (tests, local dev)", () => {
    expect(landingRedirect(at("/", "yomizaka_session=t"), rule)?.headers.get("location")).toBe("/app");
  });
});
