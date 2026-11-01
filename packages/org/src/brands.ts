import type { Localized } from "./org.types";

/**
 * The commercial names (krizaka-internal#2033, #2035, #2036): the code name stays internal, the customer reads the
 * commercial name, « Verikora by Krizaka ». Every app, site and template reads them from here — never a literal.
 *
 * These are NOT in `org.json`: the org JSON is service discovery only (the addresses and versions clients resolve). Names,
 * status, stores and the footer are admin configuration of each app (`@krizaka/settings`, audit trail); this module is the
 * seed and the validation vocabulary, not a published file.
 */

/** `product`: sold on its own. `service`: a part the products carry (Kridoc, the managed storage). */
export type BrandKind = "product" | "service";

export interface OrgBrand {
  /** The internal name: the repository, the packages, the CLI (`yomizaka`). Never on a public page. */
  codeName: string;
  /** The name the customer reads (`Verikora`). One capital; capitals only in the wordmark. */
  commercialName: string;
  kind: BrandKind;
  /** The endorsement after the name: « by Krizaka » / « par Krizaka ». */
  endorsement: Localized;
  /** The hosts of the brand (https URLs); `null` where it has none. */
  domains: { site: string; app: string | null; shop: string | null; dev: string | null };
  /** The one dated « formerly » line of the transition; `null` when the code name was never public. */
  formerly: Localized | null;
}

const ENDORSEMENT = { en: "by Krizaka", fr: "par Krizaka" };

const brand = (
  codeName: string,
  commercialName: string,
  kind: BrandKind,
  domains: OrgBrand["domains"],
  formerly: string | null,
): OrgBrand => ({
  codeName,
  commercialName,
  kind,
  endorsement: ENDORSEMENT,
  domains,
  formerly: formerly
    ? { en: `${formerly} is now ${commercialName}`, fr: `${formerly} s’appelle désormais ${commercialName}` }
    : null,
});

/** The seed: one commercial name per code name. Nothing flips to it until the readiness checklist (krizaka-internal#2092). */
export const brands: readonly OrgBrand[] = [
  brand(
    "yomizaka",
    "Verikora",
    "product",
    { site: "https://www.verikora.com", app: null, shop: null, dev: "https://dev.verikora.com" },
    "Yomizaka",
  ),
  brand(
    "akinaza",
    "Folioviv",
    "product",
    {
      site: "https://www.folioviv.com",
      app: "https://folioviv.app",
      shop: "https://folioviv.shop",
      dev: "https://dev.folioviv.com",
    },
    "Akinaza",
  ),
  brand(
    "orazaka",
    "Sovkora",
    "product",
    { site: "https://www.sovkora.com", app: null, shop: null, dev: "https://dev.sovkora.com" },
    "Orazaka",
  ),
  // Kachizaka is the code name of the managed storage (Krizaka ECM, krizaka-internal#1916); it was never public.
  brand("kachizaka", "Kridoc", "service", { site: "https://www.kridoc.com", app: null, shop: null, dev: null }, null),
];

/** The brand of a code name (`brandOf("yomizaka").commercialName` → « Verikora »). */
export const brandOf = (codeName: string): OrgBrand => {
  const found = brands.find((b) => b.codeName === codeName);
  if (!found) throw new Error(`Unknown Krizaka code name "${codeName}".`);
  return found;
};

/** The longest name an administrator may set (a bar, a store listing and an email subject must hold it). */
// @fixed: the App Store's display name limit is 30 characters; the bar and the lockup are drawn for it
export const DISPLAY_NAME_MAX = 30;

/**
 * The name an app shows: the administrator's choice (`brand.displayName` in its settings) when one is set, else the
 * commercial name. Never the code name: a setting equal to a code name falls back to the commercial name.
 */
export const displayName = (codeName: string, chosen?: string | null): string => {
  const own = chosen?.trim() ?? "";
  if (own.length === 0 || own.length > DISPLAY_NAME_MAX || codeNamePattern().test(own))
    return brandOf(codeName).commercialName;
  return own;
};

/** The lockup in words: « Verikora by Krizaka » / « Verikora par Krizaka ». `fr` reads French, anything else English. */
export const lockup = (codeName: string, locale: string, chosen?: string | null): string => {
  const { endorsement } = brandOf(codeName);
  return `${displayName(codeName, chosen)} ${locale === "fr" ? endorsement.fr : endorsement.en}`;
};

/** The words a public surface never shows: every code name, and « Krizaka ECM » (it is Kridoc). */
export const CODE_NAMES: readonly string[] = brands.map((b) => b.codeName);
const FORMER_WORDINGS: readonly [RegExp, string][] = [[/\bkrizaka\s+ecm\b/gi, "Kridoc"]];

/** The code name → commercial name map the guard prints in its hints. */
export const codeNameMap = (): Record<string, string> =>
  Object.fromEntries(brands.map((b) => [b.codeName, b.commercialName]));

const codeNamePattern = (flags = "i") => new RegExp(String.raw`\b(${CODE_NAMES.join("|")})\b`, flags);

/**
 * What is allowed to keep a code name, declared once (#2036): repository and GitHub URLs, npm and Maven coordinates,
 * the old hosts (`dev.yomizaka.com`, they redirect), code (backticks), and the one « formerly » line of each brand.
 */
const HOST_ENDINGS = [".com", ".app", ".shop", ".dev"];
const LEADING = new Set(["(", "<", "«", '"', "'"]);
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", ">", "»", '"', "'"]);
/** The token without the punctuation around it (`(dev.yomizaka.com).` → `dev.yomizaka.com`), in one linear pass. */
const trimPunctuation = (raw: string): string => {
  let start = 0;
  let end = raw.length;
  while (start < end && LEADING.has(raw[start] ?? "")) start++;
  while (end > start && TRAILING.has(raw[end - 1] ?? "")) end--;
  return raw.slice(start, end);
};
const allowedToken = (raw: string): boolean => {
  const token = trimPunctuation(raw);
  const lower = token.toLowerCase();
  return (
    (token.includes("://") && URL.canParse(token)) ||
    lower.startsWith("@krizaka/") ||
    lower.startsWith("com.krizaka") ||
    lower.startsWith("krizaka/") ||
    HOST_ENDINGS.some((end) => lower.endsWith(end) && lower.includes("."))
  );
};
const CODE_SPAN = /`[^`\n]*`/g;
/** The text with the target of every markdown link `[label](target)` blanked (lengths kept): the target is a URL, the label stays checked. Linear. */
const blankLinkTargets = (text: string): string => {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("](", at);
    if (open < 0) return out + text.slice(at);
    const start = open + 2;
    let end = start;
    while (end < text.length && text[end] !== ")" && text[end] !== "\n") end++;
    if (text[end] !== ")") {
      out += text.slice(at, start);
      at = start;
      continue;
    }
    out += text.slice(at, start) + " ".repeat(end - start);
    at = end;
  }
};

export interface CodeNameHit {
  /** The word found, as written. */
  word: string;
  /** What to write instead. */
  use: string;
  /** Up to 40 characters around it. */
  context: string;
}

/** The text with every allowed span blanked (lengths kept, so contexts stay readable). */
const blankAllowed = (text: string): string => {
  let out = text;
  for (const brand of brands) {
    for (const line of brand.formerly ? [brand.formerly.en, brand.formerly.fr] : [])
      out = out.split(line).join(" ".repeat(line.length));
  }
  out = blankLinkTargets(out).replace(CODE_SPAN, (m) => " ".repeat(m.length));
  return out.replace(/\S+/g, (m) => (allowedToken(m) ? " ".repeat(m.length) : m));
};

/** The code names a piece of customer-facing text shows (case-insensitive, whole words), minus the allowed spans. */
export const findCodeNames = (text: string): CodeNameHit[] => {
  const scanned = blankAllowed(text);
  const map = codeNameMap();
  const hits: CodeNameHit[] = [];
  const around = (i: number, n: number) =>
    text
      .slice(Math.max(0, i - 20), i + n + 20)
      .replace(/\s+/g, " ")
      .trim();
  for (const m of scanned.matchAll(codeNamePattern("gi"))) {
    hits.push({ word: m[0], use: map[m[0].toLowerCase()] ?? "", context: around(m.index ?? 0, m[0].length) });
  }
  for (const [re, use] of FORMER_WORDINGS) {
    for (const m of scanned.matchAll(re)) hits.push({ word: m[0], use, context: around(m.index ?? 0, m[0].length) });
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
 * comments are left out, and so are class names and links (a `brand-yomizaka` class or a GitHub href is not shown).
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
 * The values of a message catalogue (EN/FR JSON), keyed by their path. A key path may name a code name
 * (`site.yomizaka.title`): keys are structure; only the values are read by a customer.
 */
export const catalogueValues = (catalogue: unknown, path = ""): [string, string][] => {
  if (typeof catalogue === "string") return [[path, catalogue]];
  if (Array.isArray(catalogue)) return catalogue.flatMap((v, i) => catalogueValues(v, `${path}[${i}]`));
  if (catalogue && typeof catalogue === "object") {
    return Object.entries(catalogue).flatMap(([k, v]) => catalogueValues(v, path ? `${path}.${k}` : k));
  }
  return [];
};
