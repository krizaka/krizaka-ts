#!/usr/bin/env node
// krizaka-code-names — a public surface never shows a code name where the commercial name is required (krizaka-internal#2036).
//   krizaka-code-names [--report] [--allow <path-part>]... <file-or-dir>...
// Reads built HTML (visible text, title, description, social metadata, alt/title/aria-label), message catalogues (values only),
// and any other text file (emails, receipts, stores/*.json, llms.txt). `--allow` skips the files whose path contains the part
// (internal pages, developer pages). Exit 1 on a hit; `--report` prints and exits 0 (a repo starts as a report, then requires it).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { catalogueValues, findCodeNames, visibleText } from "../dist/index.js";

const args = process.argv.slice(2);
const report = args.includes("--report");
const allow = [];
const roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--report") continue;
  if (args[i] === "--allow") allow.push(args[++i]);
  else roots.push(args[i]);
}
if (roots.length === 0) {
  console.error("usage: krizaka-code-names [--report] [--allow <path-part>]... <file-or-dir>...");
  process.exit(2);
}
const TEXT = new Set([".html", ".htm", ".json", ".txt", ".md", ".mjml", ".hbs", ".xml", ".vtt"]);
const files = [];
const walk = (p) => {
  if (allow.some((a) => p.includes(a))) return;
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) if (e !== "node_modules" && !e.startsWith(".")) walk(join(p, e));
  } else if (TEXT.has(extname(p).toLowerCase())) files.push(p);
};
roots.forEach(walk);

let count = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const ext = extname(file).toLowerCase();
  let pieces;
  if (ext === ".html" || ext === ".htm") pieces = [["", visibleText(raw)]];
  else if (ext === ".json") {
    try {
      pieces = catalogueValues(JSON.parse(raw));
    } catch {
      pieces = [["", raw]];
    }
  } else pieces = [["", raw]];
  for (const [key, text] of pieces) {
    for (const hit of findCodeNames(text)) {
      count++;
      console.log(`${file}${key ? ` ${key}` : ""}: « ${hit.word} » → « ${hit.use} »  …${hit.context}…`);
    }
  }
}
console.log(`${count} code name(s) on public surfaces in ${files.length} file(s)${report ? " (report only)" : ""}.`);
process.exit(count > 0 && !report ? 1 : 0);
