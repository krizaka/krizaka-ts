import { family } from "../family";
import type { FamilyGroup, FamilyMember, Localized, MemberStatus } from "../org.types";

/** What a surface shows: a block between two markers, or a bio text. */
export const SURFACES = [
  "org-profile",
  "member-readme",
  "repo-readme",
  "founder-profile",
  "founder-bio",
  "social-bios",
] as const;
export type Surface = (typeof SURFACES)[number];
export type Lang = "en" | "fr";

export const START = "<!-- krizaka:family:start -->";
export const END = "<!-- krizaka:family:end -->";

const STATUS_WORDS: Record<MemberStatus, Localized> = {
  design: { en: "In design", fr: "En conception" },
  upcoming: { en: "Coming soon", fr: "Bientôt" },
  construction: { en: "Under construction", fr: "En construction" },
  development: { en: "In development", fr: "En développement" },
  devPreview: { en: "Developer preview", fr: "Aperçu pour développeurs" },
  paused: { en: "Paused", fr: "En pause" },
  released: { en: "Released", fr: "Publié" },
  retired: { en: "Retired", fr: "Retiré" },
};

const HEADINGS: Record<"products" | "open-source", Localized & { count?: never }> = {
  products: { en: "What Krizaka builds", fr: "Ce que Krizaka construit" },
  "open-source": { en: "Open source", fr: "Libre" },
};

const SOCIAL_LIMITS = { instagram: 150, x: 160, github: 160, linkedin: 120 } as const;

const publicMembers = (group: FamilyGroup): FamilyMember[] =>
  family.filter((m) => m.group === group && m.visibility === "public").sort((a, b) => a.order - b.order);

/** The link of a member: its site while it answers, else its public repository; never a private one. */
const linkOf = (m: FamilyMember): string | null => (m.urls.siteLive && m.urls.site ? m.urls.site : m.urls.repo);

/** The member's line without its own name in front (« Verikora: read a… » → « read a… »). */
const lineOf = (m: FamilyMember, lang: Lang): string => {
  const line = m.words.line[lang];
  const prefix = [`${m.name}: `, `${m.name} : `].find((p) => line.startsWith(p));
  return prefix ? line.slice(prefix.length) : line;
};

const bullet = (m: FamilyMember, lang: Lang, withStatus: boolean): string => {
  const link = linkOf(m);
  const name = link ? `**[${m.name}](${link})**` : `**${m.name}**`;
  const line = lineOf(m, lang).replace(/\.$/, "");
  const status = withStatus ? ` ${STATUS_WORDS[m.status][lang]}.` : "";
  return `- ${name} · ${line}.${status}`;
};

const section = (group: "products" | "open-source", lang: Lang, level: string): string[] => [
  `${level} ${HEADINGS[group][lang]}`,
  "",
  ...publicMembers(group).map((m) => bullet(m, lang, group === "products")),
];

const block = (lines: string[]): string => [START, ...lines, END].join("\n");

const names = (group: FamilyGroup): string[] => publicMembers(group).map((m) => m.name);
const AND: Localized = { en: "and", fr: "et" };
const list = (items: string[], lang: Lang): string => {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${AND[lang]} ${items.at(-1)}`;
};

const bio = (lang: Lang): string =>
  lang === "fr"
    ? `Fondateur de Krizaka, Montréal. Je construis ${list(names("products"), lang)}.`
    : `Founder of Krizaka, Montréal. Building ${list(names("products"), lang)}.`;

const socialBios = (lang: Lang): string =>
  Object.entries(SOCIAL_LIMITS)
    .map(([network, limit]) => {
      const text =
        lang === "fr"
          ? `Krizaka, Montréal : ${names("products").join(", ")}. krizaka.com`
          : `Krizaka, Montréal: ${names("products").join(", ")}. krizaka.com`;
      return `## ${network} (${limit})\n${text}`;
    })
    .join("\n\n");

const RENDERERS: Record<Surface, (lang: Lang) => string> = {
  "org-profile": (lang) => block([...section("products", lang, "###"), "", ...section("open-source", lang, "###")]),
  "member-readme": (lang) => block(section("products", lang, "###")),
  "repo-readme": (lang) => block([...section("products", lang, "####"), "", ...section("open-source", lang, "####")]),
  "founder-profile": (lang) => block([...section("products", lang, "###"), "", ...section("open-source", lang, "###")]),
  "founder-bio": bio,
  "social-bios": socialBios,
};

/** The text a surface must show, from the family table. A block surface comes wrapped in its two markers. */
export const renderSurface = (surface: Surface, lang: Lang = "en"): string => RENDERERS[surface](lang);

const BLOCK_SURFACES: ReadonlySet<Surface> = new Set([
  "org-profile",
  "member-readme",
  "repo-readme",
  "founder-profile",
]);

/** What a file shows of a surface: the lines between the markers, or the whole text for a bio. `null`: no block. */
const extract = (surface: Surface, file: string): string | null => {
  if (!BLOCK_SURFACES.has(surface)) return file.trim();
  const from = file.indexOf(START);
  const to = file.indexOf(END, from + 1);
  return from < 0 || to < 0 ? null : file.slice(from, to + END.length);
};

/** A line diff by longest common subsequence: `- ` expected and missing, `+ ` shown and not expected. */
const lineDiff = (expected: string[], shown: string[]): string[] => {
  const table = Array.from({ length: expected.length + 1 }, () => new Array<number>(shown.length + 1).fill(0));
  for (let i = expected.length - 1; i >= 0; i--)
    for (let j = shown.length - 1; j >= 0; j--)
      table[i]![j] =
        expected[i] === shown[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < expected.length || j < shown.length) {
    if (i < expected.length && j < shown.length && expected[i] === shown[j]) {
      i++;
      j++;
    } else if (j >= shown.length || (i < expected.length && table[i + 1]![j]! >= table[i]![j + 1]!))
      out.push(`- ${expected[i++]}`);
    else out.push(`+ ${shown[j++]}`);
  }
  return out;
};

export interface CheckResult {
  ok: boolean;
  /** Empty when ok; else the `-` expected / `+` shown lines. */
  diff: string;
}

/** Compare what a file shows of a surface with the expected view. */
export const checkSurface = (surface: Surface, file: string, lang: Lang = "en"): CheckResult => {
  const expected = renderSurface(surface, lang).trim();
  const shown = extract(surface, file);
  if (shown === null) return { ok: false, diff: `no ${START} … ${END} block in the file; expected:\n${expected}` };
  if (shown === expected) return { ok: true, diff: "" };
  return { ok: false, diff: lineDiff(expected.split("\n"), shown.split("\n")).join("\n") };
};
