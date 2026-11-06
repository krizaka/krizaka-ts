#!/usr/bin/env node
// krizaka-code-names — no retired code name anywhere (founder, 2026-11-06, krizaka-internal#2659; first #2036).
//   krizaka-code-names [--report] [--allow <path-part>]... <file-or-dir>...
// Reads every text file under the roots — code, configs, workflows, docs, messages, built HTML (raw: links, classes and
// scripts included) — and refuses the four retired code names in any case, as a word or inside one. There is no allowed
// span: the historic table is `CODE_NAMES` of @krizaka/org, and history (CHANGELOG.md files) is skipped. `--allow` skips the
// files whose path contains the part (a repository's own copy of the rename table). Binary files, node_modules and .git are
// skipped. Exit 1 on a hit; `--report` prints and exits 0.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { findCodeNames } from "../dist/index.js";

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
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".hg", ".svn"]);
const HISTORY = new Set(["CHANGELOG.md"]);
const files = [];
const walk = (p) => {
  if (allow.some((a) => p.includes(a))) return;
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) if (!SKIPPED_DIRS.has(e)) walk(join(p, e));
  } else if (!HISTORY.has(basename(p))) files.push(p);
};
roots.forEach(walk);

/** A file is text when its first 8 KiB hold no NUL byte. */
const isText = (buf) => !buf.subarray(0, 8192).includes(0);

let count = 0;
let read = 0;
for (const file of files) {
  const buf = readFileSync(file);
  if (!isText(buf)) continue;
  read++;
  const lines = buf.toString("utf8").split("\n");
  lines.forEach((line, i) => {
    for (const hit of findCodeNames(line)) {
      count++;
      console.log(`${file}:${i + 1}: « ${hit.word} » → « ${hit.use} »  …${hit.context}…`);
    }
  });
}
console.log(`${count} retired code name(s) in ${read} file(s)${report ? " (report only)" : ""}.`);
process.exit(count > 0 && !report ? 1 : 0);
