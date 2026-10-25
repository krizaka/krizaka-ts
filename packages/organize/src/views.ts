/**
 * Saved views (ADR-003 §3): the filters of a list, the URL holds them. Pure rules, browser-safe: a shared link opens the same list
 * on the web, the phone and macOS. `parseView` forgives (an address is typed, pasted, old); `checkViewFilters` refuses (what is saved).
 */
import { ORGANIZE_CODE, OrganizeError } from "./errors";
import { isId, isRecord } from "./rules";
import { isKey, type StatusSet } from "./status-sets";

/** The filters of a list. `tags`: ALL of them; `status`: any of them; `from`/`to`: calendar days, both included; `q`: text. */
export interface ViewFilters {
  tags?: string[];
  status?: string[];
  collection?: string;
  from?: string;
  to?: string;
  q?: string;
}

// @fixed: the length of a text search typed in a list's field
export const QUERY_MAX = 100;
// @fixed: as many tags or states as a filter bar can show
export const FILTER_VALUES_MAX = 20;

/** The parameters of a view, in their canonical order. */
export const VIEW_PARAMS = ["view", "tags", "status", "collection", "from", "to", "q"] as const;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A calendar day `YYYY-MM-DD` that exists (no 2026-02-30). */
export function isDay(value: unknown): value is string {
  const m = typeof value === "string" ? DAY.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

type Params = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;
const read = (params: Params, name: string): string[] => {
  if (params instanceof URLSearchParams) return params.getAll(name);
  const value = params[name];
  return value === undefined ? [] : typeof value === "string" ? [value] : [...value];
};
const list = (params: Params, name: string) => [...new Set(read(params, name).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
const cleanQuery = (raw: string) => raw.replace(/\s+/g, " ").trim();

/**
 * A view from an address: `?view=&tags=&status=&collection=&from=&to=&q=`. What is malformed is dropped, never an error.
 * @param params the search parameters (`URLSearchParams`, or Next.js' `searchParams` object)
 * @returns the view's id or key (null when none) and the filters, without empty fields
 */
export function parseView(params: Params): { view: string | null; filters: ViewFilters } {
  const filters: ViewFilters = {};
  const tags = list(params, "tags").filter(isId).slice(0, FILTER_VALUES_MAX);
  if (tags.length) filters.tags = tags;
  const status = list(params, "status").filter(isKey).slice(0, FILTER_VALUES_MAX);
  if (status.length) filters.status = status;
  const [collection] = read(params, "collection");
  if (isId(collection)) filters.collection = collection;
  const [from] = read(params, "from");
  const [to] = read(params, "to");
  const dayFrom = isDay(from) ? from : undefined;
  const dayTo = isDay(to) ? to : undefined;
  if (!(dayFrom && dayTo && dayFrom > dayTo)) Object.assign(filters, dayFrom ? { from: dayFrom } : {}, dayTo ? { to: dayTo } : {});
  const q = cleanQuery(read(params, "q")[0] ?? "");
  if (q && q.length <= QUERY_MAX) filters.q = q;
  const [view] = read(params, "view");
  return { view: view && (isId(view) || isKey(view)) ? view : null, filters };
}

/**
 * The query string of a view, in one canonical order, without `?` (empty when there is nothing).
 * @param filters the filters
 * @param view a saved view's id or a system view's key
 */
export function viewSearch(filters: ViewFilters, view?: string | null): string {
  const out = new URLSearchParams();
  if (view) out.set("view", view);
  if (filters.tags?.length) out.set("tags", filters.tags.join(","));
  if (filters.status?.length) out.set("status", filters.status.join(","));
  if (filters.collection) out.set("collection", filters.collection);
  if (filters.from) out.set("from", filters.from);
  if (filters.to) out.set("to", filters.to);
  if (filters.q) out.set("q", filters.q);
  return out.toString().replace(/%2C/g, ",");
}

/** The same path with a view: the URL is the state. */
export const viewHref = (path: string, filters: ViewFilters, view?: string | null): string => {
  const search = viewSearch(filters, view);
  return search ? `${path}?${search}` : path;
};

/** Whether two sets of filters select the same list (the « modified » mark of a view). */
export const sameFilters = (a: ViewFilters, b: ViewFilters): boolean => viewSearch(normalised(a)) === viewSearch(normalised(b));
const normalised = (f: ViewFilters): ViewFilters => ({ ...f, tags: f.tags ? [...f.tags].sort() : undefined, status: f.status ? [...f.status].sort() : undefined });


function valuesProblem(value: unknown, name: string, ok: (v: unknown) => boolean): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > FILTER_VALUES_MAX || !value.every(ok)) return [`${name}: at most ${FILTER_VALUES_MAX} valid values`];
  return [];
}

/**
 * The filters of a view that is saved, checked as they came (never a trimmed copy): the same rules as the address, refused instead of dropped.
 * @param input the filters to save
 * @param status the kind's status set, when it has one: a status filter names its states
 * @throws OrganizeError `BAD_REQUEST` listing every problem
 */
export function checkViewFilters(input: unknown, status: StatusSet | null): ViewFilters {
  if (!isRecord(input)) throw new OrganizeError(ORGANIZE_CODE.badRequest, "filters are an object");
  const known = new Set<string>(VIEW_PARAMS);
  const states = new Set(status?.states.map((s) => s.key) ?? []);
  const problems = [
    ...Object.keys(input).filter((k) => !known.has(k) || k === "view").map((k) => `${k}: not a filter`),
    ...valuesProblem(input.tags, "tags", isId),
    ...valuesProblem(input.status, "status", (v) => typeof v === "string" && states.has(v)),
    ...(input.collection === undefined || isId(input.collection) ? [] : ["collection: an id"]),
    ...(input.from === undefined || isDay(input.from) ? [] : ["from: a day YYYY-MM-DD"]),
    ...(input.to === undefined || isDay(input.to) ? [] : ["to: a day YYYY-MM-DD"]),
    ...(isDay(input.from) && isDay(input.to) && input.from > input.to ? ["from: on or before to"] : []),
    ...(input.q === undefined || (typeof input.q === "string" && input.q === cleanQuery(input.q) && input.q.length > 0 && input.q.length <= QUERY_MAX) ? [] : [`q: 1 to ${QUERY_MAX} characters, spaces collapsed`]),
  ];
  if (problems.length > 0) throw new OrganizeError(ORGANIZE_CODE.badRequest, problems.join("; "));
  return input as ViewFilters;
}
