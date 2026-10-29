// krizaka-edit-check: the one-file check a coding agent runs after each edit (ADR-015 §7). Never Maven, never a compile.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";

/** The PMD distribution, pinned: the release asset and its digest (the PMD of krizaka-build's maven-pmd-plugin 3.28). */
export const PMD = {
  version: "7.14.0",
  url: "https://github.com/pmd/pmd/releases/download/pmd_releases%2F7.14.0/pmd-dist-7.14.0-bin.zip",
  digest: "935753029c25257384854e4fba806d7e0438f5298ff6c0839dd223e387b6b52f",
};
/** The Krizaka rules, one source for the build and for this check. */
export const RULES_URL =
  "https://raw.githubusercontent.com/krizaka/krizaka-build/main/krizaka-quality/src/main/resources/krizaka-quality/pmd-ruleset.xml";
/** The time a check may take; past it the check stays silent (an edit is never blocked by a slow tool). */
export const BUDGET_MS = 10_000;

const ESLINT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const NO_FINDING = { code: 0, message: "" };
/** What Prettier formats in a Krizaka repository (the `format:check` glob of the formatter rule, krizaka/.github#427). */
const PRETTIER_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"]);
const PRETTIER_CONFIGS = ["prettier.config.js", "prettier.config.mjs", "prettier.config.cjs", ".prettierrc", ".prettierrc.json"];

/**
 * Which tool checks a file.
 * @param {string} file The edited file.
 * @returns {"eslint" | "pmd" | null} The tool, or null when the file is not checked (tests, generated, other languages).
 */
export function classify(file) {
  const path = file.replaceAll("\\", "/");
  if (/(^|\/)(node_modules|target|dist|build|\.next)\//.test(path)) return null;
  if (extname(path) === ".java") return /(^|\/)src\/test\//.test(path) ? null : "pmd";
  return ESLINT_EXTENSIONS.has(extname(path)) ? "eslint" : null;
}

/**
 * The edited file, from the argument or from the JSON a Claude Code hook writes on stdin.
 * @param {string | undefined} argument The first command-line argument.
 * @param {string} stdin What the hook wrote (empty when run by hand).
 * @returns {string | null} The path, or null when there is none.
 */
export function editedFile(argument, stdin) {
  if (argument) return argument;
  try {
    const input = JSON.parse(stdin);
    const path = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

/**
 * The closest folder above a file that holds a path.
 * @param {string} file The edited file.
 * @param {string} marker A path relative to the folder, such as `node_modules/.bin/eslint`.
 * @returns {string | null} The folder, or null.
 */
export function findUp(file, marker) {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, marker))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The arguments of the single-file PMD run.
 * @param {string} rules The rules file.
 * @param {string} file The Java file.
 * @returns {string[]} The `pmd` arguments.
 */
export function pmdArguments(rules, file) {
  return ["check", "--no-cache", "--no-progress", "--no-fail-on-violation", "-f", "text", "-R", rules, "-d", file];
}

/**
 * Runs a command with the time budget.
 * @param {string} command The program.
 * @param {string[]} args Its arguments.
 * @param {string} cwd Where it runs.
 * @param {number} budgetMs The time it may take.
 * @returns {{ status: number | null, output: string, timedOut: boolean }} How it ended.
 */
export function runBudgeted(command, args, cwd, budgetMs) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: budgetMs, killSignal: "SIGKILL" });
  const timedOut = /** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code === "ETIMEDOUT" || result.signal === "SIGKILL";
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(), timedOut };
}

/**
 * Checks a TypeScript or JavaScript file with the repository's ESLint.
 * @param {string} file The edited file.
 * @param {number} budgetMs The time budget.
 * @returns {{ code: number, message: string }} 2 and the findings, else 0.
 */
export function checkWithEslint(file, budgetMs = BUDGET_MS) {
  const root = findUp(file, "node_modules/.bin/eslint");
  if (!root) return NO_FINDING;
  const args = ["--no-warn-ignored", "--max-warnings", "0", "--format", "unix", resolve(file)];
  const run = runBudgeted(join(root, "node_modules/.bin/eslint"), args, root, budgetMs);
  // 1 = findings; 2 = ESLint itself could not run (a config in progress): the agent is not told.
  return run.status === 1 && !run.timedOut ? { code: 2, message: run.output } : NO_FINDING;
}

/**
 * Formats a file with the repository's Prettier, in place, when the repository has adopted it (the binary and a config).
 * Silent: formatting is never a finding, the agent just writes formatted code.
 * @param {string} file The edited file.
 * @param {number} budgetMs The time budget.
 * @returns {boolean} True when Prettier ran and succeeded.
 */
export function formatWithPrettier(file, budgetMs = BUDGET_MS) {
  if (!PRETTIER_EXTENSIONS.has(extname(file))) return false;
  const root = findUp(file, "node_modules/.bin/prettier");
  if (!root || !PRETTIER_CONFIGS.some((name) => existsSync(join(root, name)))) return false;
  const run = runBudgeted(join(root, "node_modules/.bin/prettier"), ["--write", "--log-level", "silent", resolve(file)], root, budgetMs);
  return run.status === 0 && !run.timedOut;
}

/**
 * Where the pinned PMD and the rules are cached.
 * @param {NodeJS.ProcessEnv} env The environment.
 * @returns {string} The cache folder.
 */
export function cacheDir(env = process.env) {
  return env.OPERATOR_CACHE_DIR ?? join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "krizaka");
}

/**
 * Verifies a download against the pinned digest.
 * @param {Buffer} bytes The downloaded archive.
 * @param {string} expected The SHA-256, in hexadecimal.
 * @returns {boolean} True when it is the pinned archive.
 */
export function matchesDigest(bytes, expected) {
  return createHash("sha256").update(bytes).digest("hex") === expected;
}

/**
 * Downloads and unpacks the pinned PMD and the rules into the cache. Run once, detached, by the first check.
 * @param {string} cache The cache folder.
 * @returns {Promise<void>} Resolves when the cache is complete; throws on a digest mismatch.
 */
export async function installPmd(cache) {
  mkdirSync(cache, { recursive: true });
  const response = await fetch(PMD.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matchesDigest(bytes, PMD.digest)) throw new Error(`PMD ${PMD.version}: digest mismatch, nothing installed`);
  const zip = join(cache, `pmd-${PMD.version}.zip`);
  writeFileSync(zip, bytes);
  const staging = join(cache, `.pmd-${process.pid}`);
  spawnSync("/usr/bin/unzip", ["-q", "-o", zip, "-d", staging], { stdio: "ignore" });
  renameSync(join(staging, `pmd-bin-${PMD.version}`), join(cache, `pmd-bin-${PMD.version}`));
  const rules = await fetch(RULES_URL);
  if (rules.ok) writeFileSync(join(cache, "pmd-ruleset.xml"), await rules.text());
}

/**
 * Checks a Java file with PMD and the Krizaka rules; the first call only starts the install, silently.
 * @param {string} file The edited file.
 * @param {{ cache?: string, budgetMs?: number, script?: string }} options Cache folder, budget, and the bin to install with.
 * @returns {{ code: number, message: string }} 2 and the findings, else 0.
 */
export function checkWithPmd(file, options = {}) {
  const cache = options.cache ?? cacheDir();
  const pmd = join(cache, `pmd-bin-${PMD.version}`, "bin", "pmd");
  const rules = process.env.OPERATOR_PMD_RULES ?? join(cache, "pmd-ruleset.xml");
  if (!existsSync(pmd) || !existsSync(rules)) {
    if (options.script) spawn(process.execPath, [options.script, "--install"], { detached: true, stdio: "ignore" }).unref();
    return NO_FINDING;
  }
  const run = runBudgeted(pmd, pmdArguments(rules, resolve(file)), dirname(resolve(file)), options.budgetMs ?? BUDGET_MS);
  const findings = run.output.split("\n").filter((line) => /\.java:\d+:/.test(line));
  return findings.length > 0 && !run.timedOut ? { code: 2, message: findings.join("\n") } : NO_FINDING;
}

/**
 * The real path of a file that is a regular file inside the project (the working directory), else null. The path comes from a
 * hook's input: nothing outside the project is ever handed to a tool.
 * @param {string} file The path as the hook gave it.
 * @param {string} cwd The project folder.
 * @returns {string | null} The real path, or null.
 */
export function insideProject(file, cwd = process.cwd()) {
  let base;
  let real;
  try {
    base = realpathSync(cwd);
    real = realpathSync(resolve(base, file));
  } catch {
    return null;
  }
  if (!real.startsWith(base + sep)) return null;
  const rebuilt = fromListing(base, real.slice(base.length + 1).split(sep));
  try {
    return rebuilt && statSync(rebuilt).isFile() ? rebuilt : null;
  } catch {
    return null;
  }
}

/**
 * A path rebuilt from the folder listings themselves, one segment at a time: what comes out was read from the disk, never copied
 * from the hook's input, so nothing the agent typed reaches a tool as a path.
 * @param {string} base The project folder (real path).
 * @param {string[]} segments The path below it.
 * @returns {string | null} The path, or null when a segment is not listed.
 */
function fromListing(base, segments) {
  let current = base;
  for (const segment of segments) {
    const listed = readdirSync(current).find((name) => name === segment);
    if (listed === undefined) return null;
    current = join(current, listed);
  }
  return current;
}

/**
 * Formats then checks one edited file.
 * @param {string} file The edited file.
 * @param {{ cwd?: string, cache?: string, budgetMs?: number, script?: string }} options The project folder, passed on to the PMD check.
 * @returns {{ code: number, message: string }} 2 and the findings for the agent, else 0 and nothing.
 */
export function checkFile(file, options = {}) {
  const inside = insideProject(file, options.cwd);
  if (!inside) return NO_FINDING;
  formatWithPrettier(inside, options.budgetMs);
  const tool = classify(inside);
  if (!tool) return NO_FINDING;
  return tool === "eslint" ? checkWithEslint(inside, options.budgetMs) : checkWithPmd(inside, options);
}

/**
 * Reads what a hook wrote on stdin, or "" when stdin is a terminal.
 * @returns {string} What was piped in.
 */
export function readStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
