#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool: its output is the interface */
// The ast-grep ratchet: runs `ast-grep scan` (rules/, sgconfig.yml), counts the violations per rule and refuses any
// increase against sg-ratchet.json. The counts only go down.
//   node scripts/sg-ratchet.mjs            check (CI, npm run lint)
//   node scripts/sg-ratchet.mjs --update   lower the recorded counts to the current ones (never raises one;
//                                          a rule that is new is recorded at its current count)
// Identical in every Krizaka TypeScript repository (keep the copies identical). Dependency-free.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RATCHET_FILE = "sg-ratchet.json";

/**
 * Counts violations per rule from `ast-grep scan --json=stream` output (one JSON object per line).
 * @param {string} stream
 * @returns {Record<string, number>}
 */
export function countStream(stream) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const line of stream.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    const { ruleId } = JSON.parse(text);
    if (typeof ruleId === "string") counts[ruleId] = (counts[ruleId] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<string, number>} recorded
 * @param {Record<string, number>} found violations per rule (a rule without violation is absent)
 * @param {string[]} ruleIds every rule that exists
 * @returns {{ ok: boolean, increased: string[], decreased: string[], unrecorded: string[], next: Record<string, number> }}
 */
export function compare(recorded, found, ruleIds) {
  const increased = [];
  const decreased = [];
  const unrecorded = [];
  /** @type {Record<string, number>} */
  const next = {};
  for (const id of [...ruleIds].sort()) {
    const current = found[id] ?? 0;
    if (!(id in recorded)) {
      unrecorded.push(id);
      next[id] = current;
      continue;
    }
    if (current > recorded[id]) increased.push(id);
    if (current < recorded[id]) decreased.push(id);
    next[id] = Math.min(recorded[id], current);
  }
  return { ok: increased.length === 0 && unrecorded.length === 0, increased, decreased, unrecorded, next };
}

/**
 * The pinned ast-grep of the repository, or the one on the PATH.
 * @param {string} root
 * @returns {string}
 */
export function localBin(root) {
  const local = resolve(root, "node_modules/.bin/ast-grep");
  return existsSync(local) ? local : "ast-grep";
}

function run() {
  const root = process.cwd();
  const update = process.argv.includes("--update");
  const bin = localBin(root);
  const scan = spawnSync(bin, ["scan", "--json=stream"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (scan.error || (scan.status !== 0 && scan.status !== 1)) {
    console.error(`sg-ratchet: ast-grep failed (${scan.error?.message ?? `exit ${scan.status}`})\n${scan.stderr}`);
    process.exit(2);
  }
  const found = countStream(scan.stdout);
  const ruleIds = ruleIdsFromDir(root);
  const file = resolve(root, RATCHET_FILE);
  const recorded = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).counters ?? {}) : {};
  const result = compare(recorded, found, ruleIds);

  for (const id of ruleIds) {
    const was = recorded[id];
    const now = found[id] ?? 0;
    console.log(`  ${id.padEnd(36)} ${String(now).padStart(4)}  (recorded ${was ?? "-"})`);
  }
  if (update) {
    if (result.increased.length > 0) {
      console.error(`sg-ratchet: ${result.increased.join(", ")} went up — fix the new violations; --update never raises a count.`);
      process.exit(1);
    }
    writeFileSync(file, `${JSON.stringify({ counters: result.next }, null, 2)}\n`);
    console.log(`sg-ratchet: ${RATCHET_FILE} written.`);
    return;
  }
  if (result.unrecorded.length > 0) {
    console.error(`sg-ratchet: new rule(s) not in ${RATCHET_FILE}: ${result.unrecorded.join(", ")} — run \`npm run sg:ratchet:update\`.`);
  }
  if (result.increased.length > 0) {
    console.error(`sg-ratchet: more violations than recorded for ${result.increased.join(", ")}. Run \`npx ast-grep scan\` to see them; fix them (the debt only goes down).`);
  }
  if (!result.ok) process.exit(1);
  if (result.decreased.length > 0) {
    console.log(`sg-ratchet: ${result.decreased.join(", ")} went down — run \`npm run sg:ratchet:update\` to lock the gain.`);
  }
  console.log("sg-ratchet: ok");
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function ruleIdsFromDir(root) {
  const dir = resolve(root, "rules");
  const ids = [];
  for (const name of readDirSafe(dir)) {
    if (!name.endsWith(".yml")) continue;
    const m = readFileSync(resolve(dir, name), "utf8").match(/^id:\s*(\S+)/m);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** @param {string} dir */
function readDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
