#!/usr/bin/env node
// krizaka-architecture <repo-path> [--out c4.json] [--level context|containers|components] [--text [file]]
// Without --out the JSON goes to stdout. With --level the file holds that level only: { level, nodes, edges }.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildC4, toText } from "./index.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = args[i + 1];
  return value && !value.startsWith("--") ? value : true;
};
const repoPath = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));

if (!repoPath || !existsSync(resolve(repoPath))) {
  console.error(
    "usage: krizaka-architecture <repo-path> [--out file.json] [--level context|containers|components] [--text [file.md]]",
  );
  process.exit(2);
}

const c4 = buildC4(resolve(repoPath));
const level = flag("level");
if (level && !c4.levels[level]) {
  console.error(`unknown level "${level}": context, containers or components`);
  process.exit(2);
}
const json = `${JSON.stringify(level ? c4.levels[level] : c4, null, 2)}\n`;
const out = flag("out");
const text = flag("text");

if (typeof out === "string") writeFileSync(resolve(out), json);
else if (text !== true) process.stdout.write(json);
if (typeof text === "string") writeFileSync(resolve(text), toText(c4));
else if (text === true) process.stdout.write(toText(c4));
if (typeof out === "string") {
  const counts = Object.values(c4.levels)
    .map((l) => l.nodes.length + " " + l.level + " node(s)")
    .join(", ");
  console.log(`${c4.repo}: ${counts} -> ${out}`);
}
