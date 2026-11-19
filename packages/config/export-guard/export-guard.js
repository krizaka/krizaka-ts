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
 */

export const RULES = Object.freeze([
  "sign-in",
  "dev-host",
  "code-name",
  "email",
  "amount",
  "soon",
  "licence",
  "status",
]);

const SIGN_IN_PATH = /\/sign-in(?![\w-])/i;
const SIGN_IN_WORDS = /\bSign in\b|\bSe connecter\b/i;
const DEV_HOST = /(?:^|[/"'\s@=])dev\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const AMOUNT = /[$€£]\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:[$€£]|CAD|USD|EUR)/g;
const SOON = /\bBientôt\b|\bSoon\b/i;
const LICENCE =
  /\b(FSL-\d(?:\.\d)?(?:-[A-Za-z0-9.]+)*|MIT|Apache-2\.0|AGPL-3\.0|GPL-[23](?:\.0)?(?:-only|-or-later)?|LGPL-[23](?:\.\d)?|BUSL-1\.1|BSL-1\.1|MPL-2\.0|ISC|BSD-[23]-Clause)(?![\w.-]*\w)/g;

/** @param {string} s */
const squash = (s) =>
  s
    .replace(/[\s\u00a0\u202f]+/g, "")
    .replace(/,/g, ".")
    .replace(/[.]+$/, "");

/** @param {string} path @param {readonly string[]} segments */
const inPath = (path, segments) => path.split(/[/\\.]/).some((part) => segments.includes(part.toLowerCase()));

/** @param {string} line @param {string} word */
const isWholeText = (line, word) =>
  new RegExp(`>\\s*${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<`, "i").test(line);

/**
 * @param {Policy} policy
 * @param {string} file
 * @param {string} line
 * @param {number} n
 * @returns {Finding[]}
 */
function checkLine(policy, file, line, n) {
  /** @type {Finding[]} */
  const out = [];
  /** @param {string} rule @param {string} message */
  const add = (rule, message) => out.push({ file, line: n, rule, message });

  if (SIGN_IN_PATH.test(line) || SIGN_IN_WORDS.test(line))
    add("sign-in", "a sign-in link or word: production has no account");
  if (DEV_HOST.test(line)) add("dev-host", "a dev. host: the export points at the public host only");

  const lower = line.toLowerCase();
  for (const name of policy.codeNames) {
    if (name && lower.includes(name.toLowerCase())) add("code-name", `retired code name "${name}"`);
  }

  if (!inPath(file, policy.emailPaths ?? ["privacy"])) {
    for (const m of line.matchAll(EMAIL)) add("email", `e-mail address ${m[0]} outside /privacy`);
  }

  const allowed = new Set(policy.allowedAmounts.map(squash));
  for (const m of line.matchAll(AMOUNT)) {
    if (!allowed.has(squash(m[0]))) add("amount", `amount "${m[0].trim()}" is not in the allowed list`);
  }

  if (inPath(file, policy.offerPaths ?? ["pricing", "tarifs"]) && SOON.test(line)) {
    add("soon", "« Bientôt » / « Soon » on an offer: an offer is sold or absent");
  }

  for (const m of line.matchAll(LICENCE)) {
    if (m[1] !== policy.licence) add("licence", `licence name "${m[1]}": the one licence is ${policy.licence}`);
  }

  const own = STATUS_WORDS[policy.status];
  for (const [status, words] of Object.entries(STATUS_WORDS)) {
    if (status === policy.status) continue;
    for (const word of [words.en, words.fr]) {
      if (own && (word === own.en || word === own.fr)) continue;
      if (isWholeText(line, word))
        add("status", `status "${word}" but @krizaka/org says "${own ? own.en : policy.status}"`);
    }
  }
  return out;
}

/**
 * The findings of an export, in file then line order.
 * @param {readonly ExportFile[]} files
 * @param {Policy} policy
 * @returns {Finding[]}
 */
export function checkExport(files, policy) {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap((f) => f.content.split(/\r?\n/).flatMap((line, i) => checkLine(policy, f.path, line, i + 1)));
}

/** @param {Finding} f */
export const formatFinding = (f) => `${f.file}:${f.line} ${f.rule} ${f.message}`;
