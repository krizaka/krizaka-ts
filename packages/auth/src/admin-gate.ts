/**
 * The administration's locks, as one pure decision every product shares (it was copied in each product's `lib/access.ts`): a session,
 * the ADMIN role, and an address on the allowed list. A pure function of its inputs: the product reads the session and the address
 * and maps the verdict to its own answer.
 */

/** Stable codes of a refusal. */
export const ADMIN_REFUSAL = {
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  ipNotAllowed: "IP_NOT_ALLOWED",
  notFound: "NOT_FOUND",
} as const;
export type AdminRefusal = (typeof ADMIN_REFUSAL)[keyof typeof ADMIN_REFUSAL];

/** The verdict: let in, or the status and code to answer. */
export type AdminDecision = { ok: true } | { ok: false; status: 401 | 403 | 404; code: AdminRefusal };

/**
 * The list the administration's address lock reads, from the environment's value (`AUTH_ALLOWED_IPS`): an empty list is « nobody » in
 * production and « anybody » in development, so a forgotten setting never opens the console.
 * @param list the configured addresses
 * @returns the list to hand to `requireAdmin`, or null (anybody)
 */
export function allowedIps(list: readonly string[], options: { production: boolean }): readonly string[] | null {
  if (list.length > 0) return list;
  return options.production ? [] : null;
}

/** Whether an address may use the administration: `null` allowed means anybody, an empty list nobody, and a missing address is never allowed by a list. */
export function ipAllowed(ip: string | null, allowed: readonly string[] | null): boolean {
  if (allowed === null) return true;
  return !!ip && allowed.includes(ip);
}

export interface AdminGateInput {
  /** The caller's session, or null when there is none. Only its account's role is read. */
  session: { account: { role: string } } | null;
  /** The caller's address (see `clientIp`). */
  ip: string | null;
  /** The addresses allowed (see `allowedIps`); null = anybody. */
  allowedIps: readonly string[] | null;
  /** `api` (default): 401 without a session, 403 with the reason. `page`: the administration does not announce itself, so every failed lock is a 404. */
  surface?: "api" | "page";
  /** The role that administers. Default `ADMIN`. */
  role?: string;
}

/**
 * The administration's three locks. The first that fails decides.
 * @returns `{ ok: true }`, or the status (401, 403 or 404 on a page) and the code to answer
 */
export function requireAdmin(input: AdminGateInput): AdminDecision {
  const page = input.surface === "page";
  const refuse = (status: 401 | 403, code: AdminRefusal): AdminDecision =>
    page ? { ok: false, status: 404, code: ADMIN_REFUSAL.notFound } : { ok: false, status, code };
  if (!input.session) return refuse(401, ADMIN_REFUSAL.unauthenticated);
  if (input.session.account.role !== (input.role ?? "ADMIN")) return refuse(403, ADMIN_REFUSAL.forbidden);
  if (!ipAllowed(input.ip, input.allowedIps)) return refuse(403, ADMIN_REFUSAL.ipNotAllowed);
  return { ok: true };
}
