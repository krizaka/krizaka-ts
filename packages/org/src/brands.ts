import { org } from "./org";
import type { OrgBrand } from "./org.types";

/**
 * The commercial names (krizaka-internal#2033, #2035, #2036): the code name stays internal, the customer reads the
 * commercial name, « Verikora by Krizaka ». Every app, site and template reads them from here — never a literal.
 */

/** The brand of a code name (`brandOf("yomizaka").commercialName` → « Verikora »). */
export const brandOf = (codeName: string): OrgBrand => {
  const found = org.brands.find((b) => b.codeName === codeName);
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
export const CODE_NAMES: readonly string[] = org.brands.map((b) => b.codeName);
const FORMER_WORDINGS: readonly [RegExp, string][] = [[/\bkrizaka\s+ecm\b/gi, "Kridoc"]];

/** The code name → commercial name map the guard prints in its hints. */
export const codeNameMap = (): Record<string, string> =>
  Object.fromEntries(org.brands.map((b) => [b.codeName, b.commercialName]));

const codeNamePattern = (flags = "i") => new RegExp(`\\b(${CODE_NAMES.join("|")})\\b`, flags);

/**
 * What is allowed to keep a code name, declared once (#2036): repository and GitHub URLs, npm and Maven coordinates,
 * the old hosts (`dev.yomizaka.com`, they redirect), code (backticks), and the one « formerly » line of each brand.
 */
const HOST_ENDINGS = [".com", ".app", ".shop", ".dev"];
const allowedToken = (raw: string): boolean => {
  const token = raw.replace(/[.,;:!?)\]»"']+$/, "").replace(/^[(«"']+/, "");
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
  for (const brand of org.brands) {
    for (const line of brand.formerly ? [brand.formerly.en, brand.formerly.fr] : [])
      out = out.split(line).join(" ".repeat(line.length));
  }
  out = out.replace(CODE_SPAN, (m) => " ".repeat(m.length));
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
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|pre|code|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
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
