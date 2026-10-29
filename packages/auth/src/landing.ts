// The two proxy-side rules of « a signed-in person never sees the public side » (krizaka-ui#827), the same for every
// product. Web-standard Request/Response only (a Next.js `proxy.ts` calls them). The cookie is a HINT: its presence
// decides a redirect and a placeholder, never an authorization — the page and the API still resolve the session.

/** The readable flag the proxy keeps next to the HttpOnly session cookie: « a session cookie exists », value `1`, never the token. */
export const SESSION_HINT_COOKIE = "kz-session";

const cookieValue = (headers: Headers, name: string): string | undefined => {
  const prefix = `${name}=`;
  return headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
};

/** Where a signed-in visitor of the landing route goes. */
export interface LandingRule {
  /** The product's session cookie name (`yomizaka_session`). */
  cookie: string;
  /** The landing routes (`["/", "/fr", "/en"]`): exact paths, a trailing slash tolerated. */
  landing: readonly string[];
  /** The signed-in start page, or a function of the request (the language of the address). */
  home: string | ((request: Request) => string);
  /**
   * The product's own public origin (`https://dev.yomizaka.com`), from its declared environment (APP_URL), NEVER from the
   * request: `Host` and `x-forwarded-*` are client-controlled. With it the Location is absolute on that origin (what a
   * Next.js proxy accepts). Only the origin of the value is used. Optional outside production (the Location is then
   * relative); REQUIRED in production, where a missing origin throws instead of falling back to the request's headers.
   */
  origin?: string;
}

// Linear on any input (a loop, not a `/\/+$/` regular expression: CodeQL js/polynomial-redos on the request path).
const trimmed = (path: string) => {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  return path.slice(0, end);
};

/**
 * The landing route with a session cookie answers 307 to the home before any HTML: private, never stored, varying with the
 * cookie. `null` for everything else (a signed-out visitor, another page, a write).
 */
export function landingRedirect(request: Request, rule: LandingRule): Response | null {
  // Fail loudly at the first request of a misconfigured deployment, signed in or not: never a silent fallback.
  if (!rule.origin && globalThis.process?.env?.NODE_ENV === "production") {
    throw new Error("landingRedirect: `origin` (the app's declared public URL) is required in production");
  }
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!cookieValue(request.headers, rule.cookie)) return null;
  const url = new URL(request.url);
  if (!rule.landing.some((path) => trimmed(path) === trimmed(url.pathname))) return null;
  const home = typeof rule.home === "function" ? rule.home(request) : rule.home;
  // Never built from the request's Host or scheme (client-controlled: host-header injection, open redirect). Relative by
  // default; absolute only on the origin the app configured, and a `home` that leaves that origin falls back to relative.
  const target = new URL(home, url);
  const path = `${target.pathname}${target.search}${target.hash}`;
  const base = rule.origin ? new URL(rule.origin).origin : null;
  const location = base && new URL(home, base).origin === base ? new URL(home, base).href : path;
  return new Response(null, {
    status: 307,
    headers: { Location: location, "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

/**
 * Keeps the hint flag in step with the session cookie on any response (pages stay static: the proxy runs on every request,
 * the HTML is the same for everyone). Sets it when the session cookie exists, clears it when it is gone, else touches nothing.
 */
export function sessionHint<T extends Response>(
  response: T,
  request: Request,
  options: { cookie: string; secure: boolean },
): T {
  const session = Boolean(cookieValue(request.headers, options.cookie));
  const flagged = cookieValue(request.headers, SESSION_HINT_COOKIE) === "1";
  const base = `${SESSION_HINT_COOKIE}=${session ? "1" : ""}; Path=/; SameSite=Lax${options.secure ? "; Secure" : ""}`;
  if (session && !flagged) response.headers.append("Set-Cookie", base);
  else if (!session && cookieValue(request.headers, SESSION_HINT_COOKIE) !== undefined)
    response.headers.append("Set-Cookie", `${base}; Max-Age=0`);
  return response;
}
