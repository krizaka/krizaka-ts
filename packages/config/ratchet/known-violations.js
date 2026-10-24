// The known violations of dependency-cruiser, held so that they only shrink (krizaka-ui#612). An app that adopts the
// import rules late records what it already breaks in `.dependency-cruiser-known-violations.json` (the format of
// `depcruise-baseline`, read by `depcruise --ignore-known`); this module compares that file with a real run:
//   - a violation that is not recorded is new: refused (`depcruise --ignore-known` refuses it as well);
//   - a recorded violation that is gone is a gain: `update` removes it, `check` refuses to leave it recorded, so the
//     file cannot hide a regression later;
//   - `update` never adds a line. `init` writes the file once, when it does not exist (the adoption pull request).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWN_FILE = ".dependency-cruiser-known-violations.json";
export const CONFIG_FILE = ".dependency-cruiser.cjs";

/** @typedef {{ type?: string, from: string, to: string, rule: { name: string, severity?: string }, cycle?: { name: string }[] }} Violation */

/** The identity of a violation, as depcruise matches it: the rule, the two ends, and the cycle's modules. @param {Violation} v */
export const keyOf = (v) => [v.rule.name, v.from, v.to, ...(v.cycle ?? []).map((step) => step.name)].join("\u0000");

/**
 * Compare the recorded violations with the current ones.
 * @param {Violation[]} known
 * @param {Violation[]} current
 */
export function compare(known, current) {
  const knownKeys = new Set(known.map(keyOf));
  const currentKeys = new Set(current.map(keyOf));
  return {
    added: current.filter((v) => !knownKeys.has(keyOf(v))),
    gone: known.filter((v) => !currentKeys.has(keyOf(v))),
  };
}

/** What `update` writes: the recorded violations that still happen. Never a new one. @param {Violation[]} known @param {Violation[]} current */
export const shrink = (known, current) => known.filter((v) => current.some((c) => keyOf(c) === keyOf(v)));

/** @param {Violation} v */
const describe = (v) => `${v.rule.name}: ${v.from} -> ${v.to}${v.cycle ? ` (cycle: ${v.cycle.map((step) => step.name).join(" -> ")})` : ""}`;

/**
 * The app's own dependency-cruiser first (its version is the one `depcruise` runs), then the one this package depends on.
 * dependency-cruiser is ESM-only and hides its bin from `exports`: walk up `node_modules` from the app, then resolve the entry.
 * @param {string} cwd
 */
function resolveDepcruise(cwd) {
  const bin = (/** @type {string} */ root) => join(root, "bin", "dependency-cruiser.mjs");
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = bin(join(dir, "node_modules", "dependency-cruiser"));
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) break;
  }
  let root = dirname(fileURLToPath(import.meta.resolve("dependency-cruiser")));
  while (!existsSync(bin(root)) && dirname(root) !== root) root = dirname(root);
  if (existsSync(bin(root))) return bin(root);
  throw new Error("dependency-cruiser is not installed here: add it to the devDependencies.");
}

/**
 * Run dependency-cruiser without the known file and read every violation (the `baseline` report).
 * @param {{ cwd: string, config: string, targets: string[] }} options
 * @returns {Violation[]}
 */
export function currentViolations({ cwd, config, targets }) {
  const bin = resolveDepcruise(cwd);
  const run = spawnSync(process.execPath, [bin, ...targets, "--config", config, "--output-type", "baseline"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  try {
    return JSON.parse(run.stdout);
  } catch {
    throw new Error(`dependency-cruiser failed:\n${run.stderr || run.stdout}`);
  }
}

/** @param {string} file @returns {Violation[]} */
const readKnown = (file) => JSON.parse(readFileSync(file, "utf8"));
/** @param {string} file @param {Violation[]} violations */
const writeKnown = (file, violations) => writeFileSync(file, `${JSON.stringify(violations, null, 2)}\n`);

/**
 * `check` | `update` | `init`. Returns the exit code and the lines to print.
 * @param {"check" | "update" | "init"} command
 * @param {{ cwd?: string, config?: string, known?: string, targets: string[] }} options
 * @returns {{ code: number, lines: string[] }}
 */
export function runKnownViolations(command, { cwd = process.cwd(), config = CONFIG_FILE, known = KNOWN_FILE, targets }) {
  const file = resolve(cwd, known);
  const current = currentViolations({ cwd, config, targets });
  if (command === "init") {
    if (existsSync(file)) return { code: 1, lines: [`${known} exists: the baseline is written once. Use "update" to lower it.`] };
    writeKnown(file, current);
    return { code: 0, lines: [`${known}: ${current.length} known violations recorded. They only go down.`] };
  }
  const recorded = existsSync(file) ? readKnown(file) : [];
  const { added, gone } = compare(recorded, current);
  if (command === "update") {
    writeKnown(file, shrink(recorded, current));
    const lines = [`${known}: ${recorded.length} -> ${recorded.length - gone.length} known violations.`];
    if (added.length > 0) {
      lines.push(`${added.length} new violation(s) are NOT recorded (the baseline never grows). Fix them:`, ...added.map((v) => `  ${describe(v)}`));
      return { code: 1, lines };
    }
    return { code: 0, lines };
  }
  const lines = [
    ...added.map((v) => `new: ${describe(v)}`),
    ...gone.map((v) => `fixed but still recorded: ${describe(v)}`),
  ];
  if (added.length > 0) lines.push("A new violation is never recorded: fix it (missing function? add it to the Krizaka package first).");
  if (gone.length > 0) lines.push(`Lock the gain: krizaka-known-violations update (${gone.length} fewer).`);
  if (lines.length === 0) lines.push(`${known}: ${recorded.length} known violations, none new, none fixed.`);
  return { code: added.length + gone.length > 0 ? 1 : 0, lines };
}
