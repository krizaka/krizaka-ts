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
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!cookieValue(request.headers, rule.cookie)) return null;
  const url = new URL(request.url);
  if (!rule.landing.some((path) => trimmed(path) === trimmed(url.pathname))) return null;
  const home = typeof rule.home === "function" ? rule.home(request) : rule.home;
  // Relative on purpose: behind a proxy or in CI `request.url` carries an internal scheme/host (https://localhost), and an absolute
  // Location would send the browser there. A relative Location keeps the origin the browser asked for.
  const target = new URL(home, url);
  return new Response(null, { status: 307, headers: { Location: `${target.pathname}${target.search}${target.hash}`, "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

/**
 * Keeps the hint flag in step with the session cookie on any response (pages stay static: the proxy runs on every request,
 * the HTML is the same for everyone). Sets it when the session cookie exists, clears it when it is gone, else touches nothing.
 */
export function sessionHint<T extends Response>(response: T, request: Request, options: { cookie: string; secure: boolean }): T {
  const session = Boolean(cookieValue(request.headers, options.cookie));
  const flagged = cookieValue(request.headers, SESSION_HINT_COOKIE) === "1";
  const base = `${SESSION_HINT_COOKIE}=${session ? "1" : ""}; Path=/; SameSite=Lax${options.secure ? "; Secure" : ""}`;
  if (session && !flagged) response.headers.append("Set-Cookie", base);
  else if (!session && cookieValue(request.headers, SESSION_HINT_COOKIE) !== undefined) response.headers.append("Set-Cookie", `${base}; Max-Age=0`);
  return response;
}
