import type { Localized } from "./org.types";

/**
 * The brands of Krizaka (krizaka-internal#2033, #2035; renamed 2026-11-06, krizaka-internal#2659): one id per brand, and the
 * id is the commercial name (`verikora`), the customer reads « Verikora by Krizaka ». Every app, site and template reads
 * them from here — never a literal.
 *
 * These are NOT in `org.json`: the org JSON is service discovery only (the addresses and versions clients resolve). Names,
 * status, stores and the footer are admin configuration of each app (`@krizaka/settings`, audit trail); this module is the
 * seed and the validation vocabulary, not a published file.
 */

/** `product`: sold on its own. `service`: a part the products carry (Kridoc, the managed storage). */
export type BrandKind = "product" | "service";

export interface OrgBrand {
  /** The id of the brand: its commercial name in lower case (`verikora`) — repositories, packages, hosts, CLI. */
  id: string;
  /** The name the customer reads (`Verikora`). One capital; capitals only in the wordmark. */
  commercialName: string;
  kind: BrandKind;
  /** The endorsement after the name: « by Krizaka » / « par Krizaka ». */
  endorsement: Localized;
  /** The hosts of the brand (https URLs); `null` where it has none. */
  domains: { site: string; app: string | null; shop: string | null; dev: string | null };
}

const ENDORSEMENT = { en: "by Krizaka", fr: "par Krizaka" };

const brand = (id: string, commercialName: string, kind: BrandKind, domains: OrgBrand["domains"]): OrgBrand => ({
  id,
  commercialName,
  kind,
  endorsement: ENDORSEMENT,
  domains,
});

/** The brands, one per product or service. */
export const brands: readonly OrgBrand[] = [
  brand("verikora", "Verikora", "product", {
    site: "https://www.verikora.com",
    app: null,
    shop: null,
    dev: "https://dev.verikora.com",
  }),
  brand("folioviv", "Folioviv", "product", {
    site: "https://www.folioviv.com",
    app: "https://folioviv.app",
    shop: "https://folioviv.shop",
    dev: "https://dev.folioviv.com",
  }),
  brand("sovkora", "Sovkora", "product", {
    site: "https://www.sovkora.com",
    app: null,
    shop: null,
    dev: "https://dev.sovkora.com",
  }),
  // Kridoc is the managed storage (Krizaka ECM, krizaka-internal#1916).
  brand("kridoc", "Kridoc", "service", { site: "https://www.kridoc.com", app: null, shop: null, dev: null }),
];

/**
 * The historic table, and the only place the retired code names are written (founder, 2026-11-06, krizaka-internal#2659):
 * old code name → brand id. History (commits, closed issues, CHANGELOG, released coordinates) keeps the old names; nothing
 * else does — there is no alias, `brandOf("yomizaka")` throws and names the new id.
 */
export const CODE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  yomizaka: "verikora",
  akinaza: "folioviv",
  orazaka: "sovkora",
  kachizaka: "kridoc",
});

/** The brand of an id (`brandOf("verikora").commercialName` → « Verikora »). A retired code name is refused, never mapped. */
export const brandOf = (id: string): OrgBrand => {
  const found = brands.find((b) => b.id === id);
  if (found) return found;
  const renamed = CODE_NAMES[id.toLowerCase()];
  if (renamed) throw new Error(`"${id}" is a retired code name (krizaka-internal#2659): use brandOf("${renamed}").`);
  throw new Error(`Unknown Krizaka brand "${id}".`);
};

/** The longest name an administrator may set (a bar, a store listing and an email subject must hold it). */
// @fixed: the App Store's display name limit is 30 characters; the bar and the lockup are drawn for it
export const DISPLAY_NAME_MAX = 30;

/**
 * The name an app shows: the administrator's choice (`brand.displayName` in its settings) when one is set, else the
 * commercial name. Never a retired code name: a setting that holds one falls back to the commercial name.
 */
export const displayName = (id: string, chosen?: string | null): string => {
  const own = chosen?.trim() ?? "";
  if (own.length === 0 || own.length > DISPLAY_NAME_MAX || findCodeNames(own).length > 0)
    return brandOf(id).commercialName;
  return own;
};

/** The lockup in words: « Verikora by Krizaka » / « Verikora par Krizaka ». `fr` reads French, anything else English. */
export const lockup = (id: string, locale: string, chosen?: string | null): string => {
  const { endorsement } = brandOf(id);
  return `${displayName(id, chosen)} ${locale === "fr" ? endorsement.fr : endorsement.en}`;
};

/** Retired code name → commercial name (`yomizaka` → « Verikora »): what the guard prints in its hints. */
export const codeNameMap = (): Record<string, string> =>
  Object.fromEntries(Object.entries(CODE_NAMES).map(([old, id]) => [old, brandOf(id).commercialName]));

/** Former wordings that are not code names but are retired too. */
const FORMER_WORDINGS: readonly [RegExp, string][] = [[/\bkrizaka\s+ecm\b/gi, "Kridoc"]];

/** Every retired code name, anywhere in a word, any case (`ORAZAKA_KEY`, `brand-yomizaka`, `dev.akinaza.com`). Linear. */
const codeNamePattern = () => new RegExp(`(${Object.keys(CODE_NAMES).join("|")})`, "gi");

export interface CodeNameHit {
  /** The word found, as written. */
  word: string;
  /** What to write instead, in the same case (`ORAZAKA` → `SOVKORA`, `Yomizaka` → `Verikora`, `akinaza` → `folioviv`). */
  use: string;
  /** Up to 40 characters around it. */
  context: string;
}

/** The replacement of a retired code name, in the case it was written. */
const replacementOf = (word: string): string => {
  const id = CODE_NAMES[word.toLowerCase()] ?? "";
  if (word === word.toUpperCase()) return id.toUpperCase();
  if (word[0] === word[0]?.toUpperCase()) return brandOf(id).commercialName;
  return id;
};

/**
 * The retired code names a text holds (founder, 2026-11-06: none, anywhere): every occurrence in any case, in prose, code,
 * hosts, URLs, package coordinates and code spans alike — there is no allowed span. Only the historic table above and the
 * history (CHANGELOG files, skipped by the `krizaka-code-names` bin) keep them.
 */
export const findCodeNames = (text: string): CodeNameHit[] => {
  const hits: CodeNameHit[] = [];
  const around = (i: number, n: number) =>
    text
      .slice(Math.max(0, i - 20), i + n + 20)
      .replace(/\s+/g, " ")
      .trim();
  for (const m of text.matchAll(codeNamePattern())) {
    hits.push({ word: m[0], use: replacementOf(m[0]), context: around(m.index, m[0].length) });
  }
  for (const [re, use] of FORMER_WORDINGS) {
    for (const m of text.matchAll(re)) hits.push({ word: m[0], use, context: around(m.index, m[0].length) });
  }
  return hits;
};

/** The text without the spans from `open` to `close` (an unclosed one runs to the end). Linear: no backtracking regex on page input. */
const stripBlocks = (text: string, open: string, close: string): string => {
  let out = "";
  let at = 0;
  for (;;) {
    const start = text.indexOf(open, at);
    if (start < 0) return out + text.slice(at);
    out += `${text.slice(at, start)} `;
    const end = text.indexOf(close, start + open.length);
    if (end < 0) return out;
    at = end + close.length;
  }
};

const SKIPPED_ELEMENTS = ["script", "style", "pre", "code", "svg"];
/** Where the element `name` next opens from `at` (`<code>` or `<code class…>`, never `<codex>`), or -1. */
const openingOf = (lower: string, name: string, at: number): number => {
  for (let i = lower.indexOf(`<${name}`, at); i >= 0; i = lower.indexOf(`<${name}`, i + 1)) {
    if (!/[a-z0-9-]/.test(lower[i + name.length + 1] ?? " ")) return i;
  }
  return -1;
};
/** The first skipped element that opens from `at`: its index (-1 when none) and its name. */
const nextSkipped = (lower: string, at: number): [number, string] => {
  let found: [number, string] = [-1, ""];
  for (const name of SKIPPED_ELEMENTS) {
    const i = openingOf(lower, name, at);
    if (i >= 0 && (found[0] < 0 || i < found[0])) found = [i, name];
  }
  return found;
};
/** The text with every tag (`<…>`) replaced by a space, in one linear pass (no backtracking regex on page input). */
const stripTags = (html: string): string => {
  let out = "";
  let at = 0;
  for (let open = html.indexOf("<"); open >= 0; open = html.indexOf("<", at)) {
    const close = html.indexOf(">", open + 1);
    if (close < 0) break;
    out += `${html.slice(at, open)} `;
    at = close + 1;
  }
  return out + html.slice(at);
};
/** The text without the elements a visitor does not read as prose (scripts, styles, code, svg), matched case-insensitively. */
const stripElements = (html: string): string => {
  const lower = html.toLowerCase();
  let out = "";
  let at = 0;
  while (at < html.length) {
    const [next, tag] = nextSkipped(lower, at);
    if (next < 0) return out + html.slice(at);
    out += `${html.slice(at, next)} `;
    const end = lower.indexOf(`</${tag}>`, next);
    if (end < 0) return out;
    at = end + tag.length + 3;
  }
  return out;
};

/**
 * The text a visitor reads in a built HTML page: the body text, the title, the description and social metadata, and the
 * `alt`, `title` and `aria-label` attributes. Scripts, styles, `<pre>` and `<code>` (developer pages' commands) and
 * comments are left out, and so are class names and links (a `brand-verikora` class or a GitHub href is not shown).
 */
export const visibleText = (html: string): string => {
  const attrs: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (
      /\b(?:name|property)\s*=\s*["'](?:description|og:[\w:]+|twitter:[\w:]+|application-name|apple-mobile-web-app-title)["']/i.test(
        m[0],
      )
    ) {
      const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(m[0]);
      if (content) attrs.push(content[1] ?? content[2] ?? "");
    }
  }
  for (const m of html.matchAll(/\b(?:alt|title|aria-label)\s*=\s*"([^"]*)"/gi)) attrs.push(m[1] ?? "");
  const body = stripTags(stripElements(stripBlocks(html, "<!--", "-->")))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
  return [body, ...attrs].join("\n");
};

/**
 * The values of a message catalogue (EN/FR JSON), keyed by their path. Keys are structure
 * (`site.verikora.title`); only the values are read by a customer.
 */
export const catalogueValues = (catalogue: unknown, path = ""): [string, string][] => {
  if (typeof catalogue === "string") return [[path, catalogue]];
  if (Array.isArray(catalogue)) return catalogue.flatMap((v, i) => catalogueValues(v, `${path}[${i}]`));
  if (catalogue && typeof catalogue === "object") {
    return Object.entries(catalogue).flatMap(([k, v]) => catalogueValues(v, path ? `${path}.${k}` : k));
  }
  return [];
};
