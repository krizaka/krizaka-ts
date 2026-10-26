import { isAfter } from "@krizaka/time";

import { BUCKET, CREDITS_CODE, type CreditsCode, CreditsError, type CreditsSettings, type GrantState, ON_EXHAUSTED } from "./port";

/** How much of one grant a consumption takes. */
export interface Draw {
  grantId: string;
  amount: number;
}

export type Plan = { ok: true; draws: Draw[] } | { ok: false; code: CreditsCode };

/** The defaults and bounds of the settings (the admin changes them without a redeploy). */
export const CREDITS_DEFAULTS: CreditsSettings = { timeZone: "America/Toronto", holdTtlSeconds: 900 };
// @fixed: bounds on the lifetime of a hold, in seconds: 30 seconds to a day (a sanity range, not a business parameter)
export const HOLD_TTL_BOUNDS = [30, 86_400] as const;

const alive = (s: GrantState, now: Date) => !s.closed && (s.grant.expiresAt === null || isAfter(s.grant.expiresAt, now));
const byExpiry = (a: GrantState, b: GrantState) =>
  (a.grant.expiresAt?.valueOf() ?? Infinity) - (b.grant.expiresAt?.valueOf() ?? Infinity) || a.grant.createdAt.valueOf() - b.grant.createdAt.valueOf() || a.grant.id.localeCompare(b.grant.id);

/** What the granted pots can give, each within its caps, and the first cap that held one back. */
function drawGranted(granted: readonly GrantState[], need: number): { draws: Draw[]; left: number; capped: CreditsCode | null } {
  const draws: Draw[] = [];
  let left = need;
  let capped: CreditsCode | null = null;
  for (const s of granted) {
    if (left === 0) break;
    const dayLeft = s.grant.capPerDay === null ? Infinity : Math.max(0, s.grant.capPerDay - s.usedToday);
    const monthLeft = s.grant.capPerMonth === null ? Infinity : Math.max(0, s.grant.capPerMonth - s.usedThisMonth);
    const take = Math.min(left, s.remaining, dayLeft, monthLeft);
    if (take < Math.min(left, s.remaining)) capped ??= dayLeft <= monthLeft ? CREDITS_CODE.capDay : CREDITS_CODE.capMonth;
    if (take > 0) {
      draws.push({ grantId: s.grant.id, amount: take });
      left -= take;
    }
  }
  return { draws, left, capped };
}

/** What the purchased pots can give, the oldest first. */
function drawPurchased(purchased: readonly GrantState[], need: number): { draws: Draw[]; left: number } {
  const draws: Draw[] = [];
  let left = need;
  const oldestFirst = [...purchased].sort((a, b) => a.grant.createdAt.valueOf() - b.grant.createdAt.valueOf() || a.grant.id.localeCompare(b.grant.id));
  for (const s of oldestFirst) {
    if (left === 0) break;
    const take = Math.min(left, s.remaining);
    draws.push({ grantId: s.grant.id, amount: take });
    left -= take;
  }
  return { draws, left };
}

/**
 * Plans where `need` credits come from, or says why they cannot. Pure: the same states give the same plan.
 *
 * Granted credits go first, the pot that lapses first first, each within its caps of the day and the month. If the granted pots cannot
 * give it all: a pot held back by a cap answers `CREDITS_CAP_DAY` / `CREDITS_CAP_MONTH` (the cap is a fair-use limit: purchased
 * credits do not bypass it); else a `stop` pot that is empty answers `CREDITS_EXHAUSTED`; else the purchased credits give the rest, and
 * when they cannot, `PAYWALL`. Nothing is partial: the plan covers the whole amount or refuses.
 * @param states every grant of the account with what is left (`CreditStore.grantStates`)
 * @param need credits wanted, a positive integer
 * @param now the injected clock's instant
 */
export function planDraws(states: readonly GrantState[], need: number, now: Date): Plan {
  const live = states.filter((s) => alive(s, now));
  const granted = live.filter((s) => s.grant.bucket === BUCKET.granted && s.remaining > 0).sort(byExpiry);
  const first = drawGranted(granted, need);
  if (first.left === 0) return { ok: true, draws: first.draws };
  if (first.capped) return { ok: false, code: first.capped };
  const taken = new Map(first.draws.map((d) => [d.grantId, d.amount]));
  const stopped = live.some((s) => s.grant.bucket === BUCKET.granted && s.grant.onExhausted === ON_EXHAUSTED.stop && s.remaining - (taken.get(s.grant.id) ?? 0) <= 0);
  if (stopped) return { ok: false, code: CREDITS_CODE.exhausted };
  const rest = drawPurchased(live.filter((s) => s.grant.bucket === BUCKET.purchased && s.remaining > 0), first.left);
  return rest.left === 0 ? { ok: true, draws: [...first.draws, ...rest.draws] } : { ok: false, code: CREDITS_CODE.paywall };
}

/** Drops the first `skip` credits of a plan (the ones already held back by active holds), keeping the order. */
export function skipFirst(draws: readonly Draw[], skip: number): Draw[] {
  let toSkip = skip;
  const out: Draw[] = [];
  for (const d of draws) {
    const dropped = Math.min(toSkip, d.amount);
    toSkip -= dropped;
    if (d.amount > dropped) out.push({ grantId: d.grantId, amount: d.amount - dropped });
  }
  return out;
}

/** Whether `n` is an amount of credits: a positive safe integer. @throws CreditsError `CREDITS_BAD_AMOUNT` */
export function checkAmount(n: number, what = "an amount"): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new CreditsError(CREDITS_CODE.badAmount, `${what} of credits is a positive integer, got ${n}`);
  return n;
}

const KEY = /^[\x21-\x7e]{1,150}$/;
/** An idempotency key: printable ASCII without spaces, 1 to 150 characters. @throws CreditsError `CREDITS_BAD_KEY` */
export function checkKey(key: string): string {
  if (!KEY.test(key) || key.includes(":")) throw new CreditsError(CREDITS_CODE.badKey, "An idempotency key is 1 to 150 printable characters, without spaces or a colon");
  return key;
}

/** Checks the settings the service was given. @throws CreditsError `CREDITS_BAD_SETTINGS` */
export function checkSettings(s: CreditsSettings): CreditsSettings {
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone });
  } catch {
    throw new CreditsError(CREDITS_CODE.badSettings, `Not an IANA time zone: ${s.timeZone}`);
  }
  if (!Number.isSafeInteger(s.holdTtlSeconds) || s.holdTtlSeconds < HOLD_TTL_BOUNDS[0] || s.holdTtlSeconds > HOLD_TTL_BOUNDS[1]) {
    throw new CreditsError(CREDITS_CODE.badSettings, `holdTtlSeconds is ${HOLD_TTL_BOUNDS[0]} to ${HOLD_TTL_BOUNDS[1]}`);
  }
  return s;
}

// @fixed: the longest source a line of the ledger carries (its CHECK)
const MAX_SOURCE = 200;

/** The shape of what `grant` and `purchase` take, for the checks. */
interface NewGrantInput {
  accountId: string;
  amount: number;
  source: string;
  idempotencyKey: string;
  expiresAt?: Date;
  capPerDay?: number | null;
  capPerMonth?: number | null;
  onExhausted?: string;
}

/** The checks of a granted pot's own terms: it lapses in the future, its caps are whole numbers, it says what happens when it runs out. */
function checkGrantedTerms(input: NewGrantInput, now: Date): void {
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.valueOf()) || input.expiresAt <= now) throw new CreditsError(CREDITS_CODE.badGrant, "A granted pot lapses in the future");
  for (const cap of [input.capPerDay, input.capPerMonth]) if (cap !== undefined && cap !== null) checkAmount(cap, "a cap");
  if (input.onExhausted !== ON_EXHAUSTED.stop && input.onExhausted !== ON_EXHAUSTED.fallbackPaid) throw new CreditsError(CREDITS_CODE.badGrant, "onExhausted is stop or fallback_paid");
}

/**
 * Checks what `grant` or `purchase` was given, before any store call.
 * @throws CreditsError `CREDITS_BAD_AMOUNT`, `CREDITS_BAD_KEY` or `CREDITS_BAD_GRANT`
 */
export function checkNewGrant(kind: "grant" | "purchase", input: NewGrantInput, now: Date): void {
  checkAmount(input.amount, "a grant");
  checkKey(input.idempotencyKey);
  if (!input.accountId) throw new CreditsError(CREDITS_CODE.badGrant, "A grant has an account");
  if (!input.source || input.source.length > MAX_SOURCE) throw new CreditsError(CREDITS_CODE.badGrant, `A source is 1 to ${MAX_SOURCE} characters`);
  if (kind === "grant") checkGrantedTerms(input, now);
}
