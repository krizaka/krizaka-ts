#!/usr/bin/env node
// krizaka-export-guard <dir> --product <id> [--status <status>] [--licence <id>] [--allow-amount <"49 $">]... [--code-name <name>]...
// Fails (exit 1, one `file:line rule message` per finding) when a product's public static export carries a sign-in link, a
// dev. host, a retired code name, an e-mail outside /privacy, an amount outside the allowed list, « Bientôt » / « Soon » on
// an offer, another licence name or a status different from @krizaka/org (krizaka-internal#4148). Without --code-name and
// --status the product's own @krizaka/org (resolved from the working directory) is the source.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

import { checkExport, formatFinding } from "../export-guard/export-guard.js";

const TEXT = /\.(html?|txt|xml|json|md|webmanifest)$/i;

/** @param {string} root @param {string} dir @returns {{ path: string, content: string }[]} */
function readTree(root, dir = root) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return readTree(root, full);
    return TEXT.test(name) ? [{ path: relative(root, full), content: readFileSync(full, "utf8") }] : [];
  });
}

/** @returns {Promise<any>} */
async function loadOrg() {
  const url = createRequire(join(process.cwd(), "noop.js")).resolve("@krizaka/org");
  return import(url);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    status: { type: "string" },
    licence: { type: "string", default: "FSL-1.1-ALv2" },
    "allow-amount": { type: "string", multiple: true, default: [] },
    "code-name": { type: "string", multiple: true, default: [] },
  },
});
const [dir] = positionals;
if (!dir || !values.product) {
  console.error(
    "usage: krizaka-export-guard <dir> --product <id> [--status s] [--licence id] [--allow-amount a]... [--code-name n]...",
  );
  process.exit(2);
}

let codeNames = values["code-name"] ?? [];
let status = values.status;
if (codeNames.length === 0 || !status) {
  try {
    const org = await loadOrg();
    if (codeNames.length === 0) codeNames = Object.keys(org.CODE_NAMES);
    if (!status) status = org.org.products.find((/** @type {{ id: string }} */ p) => p.id === values.product)?.status;
  } catch {
    console.error("krizaka-export-guard: @krizaka/org is not resolvable here: pass --code-name and --status.");
    process.exit(2);
  }
}
if (!status) {
  console.error(`krizaka-export-guard: no status for product "${values.product}".`);
  process.exit(2);
}

/** The folder, rebuilt one segment at a time from the directory listings under the working directory: never outside it. */
/** @param {string} base @param {string} wanted */
function folderInside(base, wanted) {
  let current = base;
  for (const segment of wanted.split(/[\\/]/).filter((part) => part !== "" && part !== ".")) {
    const entry = readdirSync(current).find((name) => name === segment);
    if (entry === undefined) return undefined;
    current = join(current, entry);
  }
  return current;
}

const root = folderInside(process.cwd(), dir);
if (root === undefined || !statSync(root).isDirectory()) {
  console.error("krizaka-export-guard: the export folder must be an existing folder inside the working directory.");
  process.exit(2);
}

const findings = checkExport(readTree(root), {
  codeNames,
  allowedAmounts: values["allow-amount"] ?? [],
  licence: values.licence ?? "FSL-1.1-ALv2",
  status,
});
if (findings.length > 0) {
  console.error(findings.map(formatFinding).join("\n"));
  console.error(`krizaka-export-guard: ${findings.length} finding(s) in the export of ${values.product}.`);
  process.exit(1);
}
console.log(`krizaka-export-guard: the export of ${values.product} is clean.`);
