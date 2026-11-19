// The export guard (krizaka-internal#4148): what a product's public static export must never carry. A pure function: the
// files of the export in, the findings out. No network, no clock, no disk (the CLI reads the folder). The product's
// specifics (retired code names, allowed amounts, licence, status) are the policy, never a branch here.
import { STATUS_WORDS } from "./status-words.js";

/**
 * @typedef {{ path: string, content: string }} ExportFile
 * @typedef {{ file: string, line: number, rule: string, message: string }} Finding
 * @typedef {{
 *   codeNames: readonly string[],
 *   allowedAmounts: readonly string[],
 *   licence: string,
 *   status: string,
 *   emailPaths?: readonly string[],
 *   offerPaths?: readonly string[],
 * }} Policy
 * @typedef {(line: string, file: string, policy: Policy) => { rule: string, message: string }[]} LineRule
 */

const SIGN_IN_PATH = /\/sign-in(?![\w-])/i;
const SIGN_IN_WORDS = /\bSign in\b|\bSe connecter\b/i;
const SOON = /\bBientôt\b|\bSoon\b/i;
const CURRENCY = /[$€£]|CAD|USD|EUR/g;
const AMOUNT_CHARS = new Set("0123456789 .,\u00a0\u202f");
const LICENCES = new Set([
  "MIT", "Apache-2.0", "AGPL-3.0", "GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "BUSL-1.1", "BSL-1.1", "MPL-2.0", "ISC",
  "BSD-2-Clause", "BSD-3-Clause",
]);

/** @param {string} s */
const squash = (s) => s.replace(/[\s\u00a0\u202f]+/g, "").replace(/,/g, ".").replace(/\.+$/, "");

/** @param {string} path @param {readonly string[]} segments */
const inPath = (path, segments) => path.split(/[/\\.]/).some((part) => segments.includes(part.toLowerCase()));

/** @param {string} c */
const isHostChar = (c) => /[\w.-]/.test(c);

/** The amounts of a line: the digits next to a currency sign, before or after it. @param {string} line @returns {string[]} */
function amountsOf(line) {
  /** @type {string[]} */
  const found = [];
  for (const m of line.matchAll(CURRENCY)) {
    let start = m.index;
    while (start > 0 && AMOUNT_CHARS.has(line.charAt(start - 1))) start--;
    let end = m.index + m[0].length;
    while (end < line.length && AMOUNT_CHARS.has(line.charAt(end))) end++;
    const text = line.slice(start, end).trim();
    if (/\d/.test(text)) found.push(text);
  }
  return found;
}

/** @param {string} line @returns {string[]} */
function emailsOf(line) {
  /** @type {string[]} */
  const found = [];
  for (let at = line.indexOf("@"); at >= 0; at = line.indexOf("@", at + 1)) {
    let start = at;
    while (start > 0 && /[\w.+-]/.test(line.charAt(start - 1))) start--;
    let end = at + 1;
    while (end < line.length && isHostChar(line.charAt(end))) end++;
    const domain = line.slice(at + 1, end).replace(/\.+$/, "");
    if (start < at && domain.includes(".")) found.push(line.slice(start, at + 1 + domain.length));
  }
  return found;
}

/** A `dev.` host label that starts a word, followed by a dotted name. @param {string} line */
function hasDevHost(line) {
  const lower = line.toLowerCase();
  for (let i = lower.indexOf("dev."); i >= 0; i = lower.indexOf("dev.", i + 1)) {
    const startsWord = i === 0 || !/[\w.-]/.test(lower.charAt(i - 1));
    const [label = "", ...more] = lower.slice(i + 4).split(".");
    if (startsWord && more.length > 0 && /^[a-z0-9-]+$/.test(label)) return true;
  }
  return false;
}

/** The text of every element on the line, trimmed. @param {string} line @returns {string[]} */
function elementTexts(line) {
  return [...line.matchAll(/>([^<>]*)</g)].map((m) => (m[1] ?? "").trim().toLowerCase());
}

/** @type {LineRule} */
const signIn = (line) =>
  SIGN_IN_PATH.test(line) || SIGN_IN_WORDS.test(line)
    ? [{ rule: "sign-in", message: "a sign-in link or word: production has no account" }]
    : [];

/** @type {LineRule} */
const devHost = (line) =>
  hasDevHost(line) ? [{ rule: "dev-host", message: "a dev. host: the export points at the public host only" }] : [];

/** @type {LineRule} */
const codeName = (line, _file, policy) => {
  const lower = line.toLowerCase();
  return policy.codeNames
    .filter((name) => name && lower.includes(name.toLowerCase()))
    .map((name) => ({ rule: "code-name", message: `retired code name "${name}"` }));
};

/** @type {LineRule} */
const email = (line, file, policy) =>
  inPath(file, policy.emailPaths ?? ["privacy"])
    ? []
    : emailsOf(line).map((e) => ({ rule: "email", message: `e-mail address ${e} outside /privacy` }));

/** @type {LineRule} */
const amount = (line, _file, policy) => {
  const allowed = new Set(policy.allowedAmounts.map(squash));
  return amountsOf(line)
    .filter((a) => !allowed.has(squash(a)))
    .map((a) => ({ rule: "amount", message: `amount "${a}" is not in the allowed list` }));
};

/** @type {LineRule} */
const soon = (line, file, policy) =>
  inPath(file, policy.offerPaths ?? ["pricing", "tarifs"]) && SOON.test(line)
    ? [{ rule: "soon", message: "« Bientôt » / « Soon » on an offer: an offer is sold or absent" }]
    : [];

/** @type {LineRule} */
const licence = (line, _file, policy) =>
  (line.match(/[\w.-]+/g) ?? [])
    .map((token) => token.replace(/[.-]+$/, ""))
    .filter((token) => token !== policy.licence && (LICENCES.has(token) || token.startsWith("FSL-")))
    .map((token) => ({ rule: "licence", message: `licence name "${token}": the one licence is ${policy.licence}` }));

/** @type {LineRule} */
const status = (line, _file, policy) => {
  const own = STATUS_WORDS[policy.status];
  const ownWords = own ? [own.en.toLowerCase(), own.fr.toLowerCase()] : [];
  const others = Object.entries(STATUS_WORDS)
    .filter(([id]) => id !== policy.status)
    .flatMap(([, w]) => [w.en, w.fr])
    .filter((w) => !ownWords.includes(w.toLowerCase()));
  const texts = elementTexts(line);
  return others
    .filter((w) => texts.includes(w.toLowerCase()))
    .map((w) => ({ rule: "status", message: `status "${w}" but @krizaka/org says "${own ? own.en : policy.status}"` }));
};

const LINE_RULES = [signIn, devHost, codeName, email, amount, soon, licence, status];

export const RULES = Object.freeze(["sign-in", "dev-host", "code-name", "email", "amount", "soon", "licence", "status"]);

/**
 * The findings of an export, in file then line order.
 * @param {readonly ExportFile[]} files
 * @param {Policy} policy
 * @returns {Finding[]}
 */
export function checkExport(files, policy) {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap((f) =>
      f.content.split(/\r?\n/).flatMap((line, i) =>
        LINE_RULES.flatMap((rule) => rule(line, f.path, policy)).map((r) => ({ file: f.path, line: i + 1, ...r })),
      ),
    );
}

/** @param {Finding} f */
export const formatFinding = (f) => `${f.file}:${f.line} ${f.rule} ${f.message}`;
