/** A parameterised query returning rows (`Query` of `@krizaka/db`, structurally: this entry point imports nothing, so a function can ship it as one file). */
export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
function ident(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new RangeError(`VISITS_UNSAFE_IDENTIFIER: « ${name} » is not a plain lower-case SQL identifier`);
  }
  return name;
}

/** One counted key: a page of a site, on a UTC day, from a referrer domain ("" when none). */
export interface VisitRow {
  site: string;
  page: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  referrerDomain: string;
}

export interface VisitStore {
  /** Counts one visit. Returns `false` when the day already holds the cap of rows and this key is new: the visit is dropped. */
  count(row: VisitRow, dailyRowCap: number): Promise<boolean>;
}

/** The most distinct (page, referrer) rows one site keeps for one day; a flood of made-up pages or referrers cannot grow the table past it. */
// @fixed: a real day holds a few hundred pairs; 2000 leaves room and bounds the table at about 730k rows a year per site
export const DEFAULT_DAILY_ROW_CAP = 2000;

/**
 * The counts in `visits.visit_counts` (see `visitsSchema`). ONE statement: an existing key is incremented; a new key is inserted only
 * while the day holds fewer rows than the cap. Two new keys racing at the cap can overshoot it by a few rows, never more.
 */
export function dbVisitStore(query: Query, options: { schema?: string } = {}): VisitStore {
  const table = `${ident(options.schema ?? "visits")}.visit_counts`;
  return {
    async count(row, dailyRowCap) {
      const rows = await query(
        `INSERT INTO ${table} AS v (site, page, day, referrer_domain, count)
         SELECT $1, $2, $3::date, $4, 1
         WHERE EXISTS (SELECT 1 FROM ${table} WHERE site = $1 AND page = $2 AND day = $3::date AND referrer_domain = $4)
            OR (SELECT count(*) FROM ${table} WHERE site = $1 AND day = $3::date) < $5
         ON CONFLICT (site, page, day, referrer_domain) DO UPDATE SET count = v.count + 1
         RETURNING 1`,
        [row.site, row.page, row.day, row.referrerDomain, dailyRowCap],
      );
      return rows.length > 0;
    },
  };
}

/** The visits of one page in one week (weeks start on Monday, UTC). */
export interface WeeklyVisits {
  /** The Monday of the week, `YYYY-MM-DD`. */
  week: string;
  page: string;
  count: number;
}

/**
 * The weekly reads per page, for the KPI report: from `since` (a `YYYY-MM-DD`) up to now, most visited first within each week. Counts
 * only; nothing here can name a person.
 */
export async function weeklyVisits(
  query: Query,
  site: string,
  since: string,
  options: { schema?: string } = {},
): Promise<WeeklyVisits[]> {
  const table = `${ident(options.schema ?? "visits")}.visit_counts`;
  const rows = await query<{ week: string; page: string; count: string | number }>(
    `SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS week, page, sum(count) AS count
       FROM ${table} WHERE site = $1 AND day >= $2::date
      GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC, 2`,
    [site, since],
  );
  return rows.map((r) => ({ week: r.week, page: r.page, count: Number(r.count) }));
}
