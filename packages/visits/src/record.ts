import { isBot } from "./bots";
import { normalisePath } from "./path";
import { referrerDomain } from "./referrer";
import { DEFAULT_DAILY_ROW_CAP, type VisitRow, type VisitStore } from "./store";

/** What a request offers. The agent and the referer are read here and never kept; there is no address in this shape. */
export interface VisitInput {
  site: string;
  /** The path of the request (`/fr/story?x=1`). */
  path: string | null | undefined;
  referer?: string | null;
  userAgent?: string | null;
}

export interface RecordOptions {
  /** The site's own hosts: a referrer from them is no source. */
  ownHosts?: readonly string[];
  dailyRowCap?: number;
  /** Told of a store failure (log it, never the request). */
  onError?: (error: unknown) => void;
}

/** The row a request counts for, or `null` when it counts for nothing (a bot, a non-page). Pure. */
export function visitRowOf(input: VisitInput, now: Date, ownHosts: readonly string[] = []): VisitRow | null {
  if (isBot(input.userAgent)) return null;
  const page = normalisePath(input.path);
  if (page === null) return null;
  return {
    site: input.site,
    page,
    day: now.toISOString().slice(0, 10),
    referrerDomain: referrerDomain(input.referer, ownHosts),
  };
}

/**
 * Counts one visit and never throws: a store that fails is reported to `onError` and the page goes on (fails closed on the count,
 * never on the page). Returns whether a count was written.
 */
export async function recordVisit(
  store: VisitStore,
  input: VisitInput,
  now: Date,
  options: RecordOptions = {},
): Promise<boolean> {
  try {
    const row = visitRowOf(input, now, options.ownHosts);
    return row ? await store.count(row, options.dailyRowCap ?? DEFAULT_DAILY_ROW_CAP) : false;
  } catch (error) {
    options.onError?.(error);
    return false;
  }
}
