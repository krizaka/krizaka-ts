/**
 * Server-side check of a Cloudflare Turnstile token (siteverify). The widget alone protects nothing: the token it hands the
 * browser is only worth something once the server has asked Cloudflare about it. Fails closed — no secret, no token, a refusal, a
 * wrong hostname or action, a replayed token, a timeout or an unreachable service all answer `ok: false` — so a form that calls
 * it never sends a message on doubt. Nothing here knows a request, an environment variable or the wall clock.
 */
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// @fixed: a Turnstile token is a few hundred characters; 2048 is Cloudflare's own documented maximum
export const TURNSTILE_MAX_TOKEN_LENGTH = 2048;
// @fixed: a form submit must not hang on the verification service
const DEFAULT_TIMEOUT_MS = 8000;
// @fixed: a token expires after 300 s at Cloudflare; remembering it for as long is enough to refuse a replay here
const REPLAY_WINDOW_MS = 300_000;
// @fixed: bounds the replay memory of one process
const MAX_REMEMBERED_TOKENS = 5000;

export type TurnstileFailure =
  "not-configured" | "missing-token" | "rejected" | "hostname" | "action" | "replayed" | "unavailable";
export type TurnstileResult = { ok: true } | { ok: false; reason: TurnstileFailure; errorCodes: string[] };

export interface TurnstileResponse {
  ok: boolean;
  json(): Promise<unknown>;
}
export type TurnstileFetch = (
  url: string,
  init: { method: string; body: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<TurnstileResponse>;

export interface TurnstileDeps {
  /** The widget's secret key (`ABUSE_TURNSTILE_SECRET`). Absent or blank: every check fails (`not-configured`). */
  secret: string | undefined;
  /** The hostnames a token may have been solved on (`www.krizaka.com`). Empty: the hostname is not checked. */
  hostnames?: readonly string[];
  /** The clock, injected. */
  now: () => Date;
  fetch?: TurnstileFetch;
  timeoutMs?: number;
}

export interface TurnstileCheck {
  token: unknown;
  /** The visitor's address; "unknown" and blank are not sent. */
  remoteIp?: string;
  /** The widget's `action`, when the form sets one: a token solved for another form is refused. */
  action?: string;
}

const fail = (reason: TurnstileFailure, errorCodes: string[] = []): TurnstileResult => ({
  ok: false,
  reason,
  errorCodes,
});

/** A verifier with its replay memory: one per process, shared by the forms. */
export function createTurnstileVerifier(deps: TurnstileDeps): (check: TurnstileCheck) => Promise<TurnstileResult> {
  const seen = new Map<string, number>();
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as TurnstileFetch);

  const remember = (token: string, nowMs: number): boolean => {
    for (const [t, at] of seen) if (nowMs - at > REPLAY_WINDOW_MS) seen.delete(t);
    if (seen.has(token)) return false;
    if (seen.size >= MAX_REMEMBERED_TOKENS) seen.delete(seen.keys().next().value as string);
    seen.set(token, nowMs);
    return true;
  };

  return async ({ token, remoteIp, action }) => {
    const secret = deps.secret?.trim();
    if (!secret) return fail("not-configured");
    if (typeof token !== "string" || !token.trim() || token.length > TURNSTILE_MAX_TOKEN_LENGTH)
      return fail("missing-token");
    if (!remember(token, deps.now().valueOf())) return fail("replayed");

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
    let answer: { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };
    try {
      const res = await doFetch(TURNSTILE_SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) return fail("unavailable");
      answer = (await res.json()) as typeof answer;
    } catch {
      return fail("unavailable");
    }
    const codes = Array.isArray(answer["error-codes"]) ? answer["error-codes"] : [];
    if (answer.success !== true) return fail("rejected", codes);
    if (deps.hostnames?.length && !deps.hostnames.includes(answer.hostname ?? "")) return fail("hostname", codes);
    if (action !== undefined && answer.action !== action) return fail("action", codes);
    return { ok: true };
  };
}
