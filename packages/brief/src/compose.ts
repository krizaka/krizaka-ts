import { type Recommendation, URGENCY } from "./recommendation";

/** Reads the product's data and returns what it found — pure, deterministic. */
export type Detector<Ctx, R extends Recommendation = Recommendation> = (ctx: Ctx) => readonly R[];

/** The falcon: refuses a recommendation (consent missing, a rule) by returning its reason, or lets it pass (null). */
export interface Guard<Ctx, R extends Recommendation = Recommendation> {
  readonly name: string;
  readonly check: (item: R, ctx: Ctx) => string | null;
}

export interface Vetoed<R extends Recommendation> {
  readonly item: R;
  readonly guard: string;
  readonly reason: string;
}

export interface Brief<R extends Recommendation> {
  readonly week: string;
  /** The top `limit`, most urgent first, then the largest impact. */
  readonly items: readonly R[];
  /** Refused by a guard, with the reason: kept for the audit, never shown as a recommendation. */
  readonly vetoed: readonly Vetoed<R>[];
  /** Passed the guards but beyond the limit. */
  readonly dropped: readonly R[];
}

export interface ComposeInput<Ctx, R extends Recommendation> {
  readonly week: string;
  readonly ctx: Ctx;
  readonly detectors: readonly Detector<Ctx, R>[];
  readonly guards?: readonly Guard<Ctx, R>[];
  readonly limit?: number;
}

/** Urgency, then impact (larger first), then id: a total order, so the same data always gives the same brief. */
export function byPriority(a: Recommendation, b: Recommendation): number {
  return (
    URGENCY[a.urgency] - URGENCY[b.urgency] || b.impactCents - a.impactCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Runs the detectors, lets the guards veto, ranks, and keeps the top `limit` (3 by default). Same id twice: the first wins. */
export function composeBrief<Ctx, R extends Recommendation>({
  week,
  ctx,
  detectors,
  guards = [],
  limit = 3,
}: ComposeInput<Ctx, R>): Brief<R> {
  const seen = new Set<string>();
  const passed: R[] = [];
  const vetoed: Vetoed<R>[] = [];
  for (const item of detectors.flatMap((detect) => detect(ctx))) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const refusal = firstRefusal(guards, item, ctx);
    if (refusal) vetoed.push({ item, ...refusal });
    else passed.push(item);
  }
  const ranked = passed.sort(byPriority);
  return { week, items: ranked.slice(0, limit), vetoed, dropped: ranked.slice(limit) };
}

function firstRefusal<Ctx, R extends Recommendation>(
  guards: readonly Guard<Ctx, R>[],
  item: R,
  ctx: Ctx,
): { guard: string; reason: string } | null {
  for (const guard of guards) {
    const reason = guard.check(item, ctx);
    if (reason) return { guard: guard.name, reason };
  }
  return null;
}
