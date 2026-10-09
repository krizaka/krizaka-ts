// The ratchet: counts the four UI debts in a repository and refuses any increase against lint-ratchet.json.
// Same patterns as the ESLint rules (../patterns.js), applied to the source text: the counter sees every
// occurrence (a class in a `cn()` argument or a constant too), so it can only be stricter than the rule.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { glob } from "tinyglobby";

import { ARBITRARY_VAR_SOURCE, CLASSNAME_TEMPLATE_SOURCE, LIGHT_VARIANT_SOURCE, paletteSource } from "../patterns.js";

export const RATCHET_FILE = "lint-ratchet.json";
export const DEFAULT_GLOBS = Object.freeze(["app/**/*.tsx", "components/**/*.tsx", "src/**/*.tsx"]);
const IGNORE = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/storybook-static/**", "**/coverage/**"];

/** @typedef {"palette" | "light" | "arbitraryVar" | "classNameTemplate"} CounterName */
/** @typedef {Record<CounterName, number>} Counters */
/** @typedef {{ globs?: string[], allow?: string[], counters: Counters }} RatchetFile */

/** The counters, in report order. */
export const COUNTERS = /** @type {const} */ (["palette", "light", "arbitraryVar", "classNameTemplate"]);

/**
 * @param {string[]} [allow] palette families tolerated (same option as krizakaUi)
 * @returns {Record<CounterName, RegExp>}
 */
export function counterPatterns(allow = []) {
  return {
    palette: new RegExp(paletteSource(allow), "g"),
    light: new RegExp(LIGHT_VARIANT_SOURCE, "g"),
    arbitraryVar: new RegExp(ARBITRARY_VAR_SOURCE, "g"),
    classNameTemplate: new RegExp(CLASSNAME_TEMPLATE_SOURCE, "g"),
  };
}

/**
 * Counts the four debts in one source text.
 * @param {string} source
 * @param {string[]} [allow]
 * @returns {Counters}
 */
export function countSource(source, allow = []) {
  const patterns = counterPatterns(allow);
  /** @type {Counters} */
  const counters = { palette: 0, light: 0, arbitraryVar: 0, classNameTemplate: 0 };
  for (const name of COUNTERS) counters[name] = source.match(patterns[name])?.length ?? 0;
  return counters;
}

/**
 * Counts the debts in every file matched by the globs under `root`.
 * @param {{ root: string, globs?: readonly string[], allow?: string[] }} options
 * @returns {Promise<{ counters: Counters, files: number }>}
 */
export async function countRepository({ root, globs = DEFAULT_GLOBS, allow = [] }) {
  const files = await glob([...globs], { cwd: root, ignore: IGNORE, absolute: true });
  /** @type {Counters} */
  const counters = { palette: 0, light: 0, arbitraryVar: 0, classNameTemplate: 0 };
  for (const file of files) {
    const found = countSource(readFileSync(file, "utf8"), allow);
    for (const name of COUNTERS) counters[name] += found[name];
  }
  return { counters, files: files.length };
}

/**
 * @param {string} path
 * @returns {RatchetFile}
 */
function readRatchet(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  for (const name of COUNTERS) {
    if (!Number.isInteger(data?.counters?.[name]) || data.counters[name] < 0) {
      throw new RatchetError(`${path}: counters.${name} must be a non-negative integer.`);
    }
  }
  return data;
}

/**
 * @param {string} path
 * @param {RatchetFile} data
 */
function writeRatchet(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** A usage or file error (exit code 2), as opposed to a counter going up (exit code 1). */
export class RatchetError extends Error {}

/**
 * @typedef {object} RatchetResult
 * @property {boolean} ok no counter above its recorded value
 * @property {"check" | "init" | "update"} mode
 * @property {string} file the ratchet file, relative to root
 * @property {number} files source files scanned
 * @property {string[]} globs
 * @property {Record<CounterName, { recorded: number, current: number, delta: number }>} counters
 * @property {CounterName[]} increased
 * @property {CounterName[]} decreased
 * @property {boolean} written the ratchet file was created or lowered
 */

/**
 * Runs the ratchet.
 * - `check` (default): fails when a counter is above its recorded value.
 * - `init`: creates the file with the current counters (refuses to overwrite one).
 * - `update`: lowers each recorded value to the current one, never raises it (still fails on an increase).
 * @param {{ root: string, mode?: "check" | "init" | "update", globs?: string[], file?: string }} options
 * @returns {Promise<RatchetResult>}
 */
export async function runRatchet({ root, mode = "check", globs, file = RATCHET_FILE }) {
  const path = resolve(root, file);
  const exists = existsSync(path);
  if (mode === "init" && exists) throw new RatchetError(`${file} already exists: use --update to lower it.`);
  if (mode !== "init" && !exists) throw new RatchetError(`${file} not found in ${root}: run krizaka-ratchet --init first.`);

  const recordedFile = exists ? readRatchet(path) : undefined;
  const useGlobs = globs && globs.length > 0 ? globs : (recordedFile?.globs ?? [...DEFAULT_GLOBS]);
  const allow = recordedFile?.allow ?? [];
  const { counters: current, files } = await countRepository({ root, globs: useGlobs, allow });
  const recorded = recordedFile?.counters ?? current;

  /** @type {RatchetResult["counters"]} */
  const report = /** @type {any} */ ({});
  /** @type {CounterName[]} */ const increased = [];
  /** @type {CounterName[]} */ const decreased = [];
  for (const name of COUNTERS) {
    const delta = current[name] - recorded[name];
    report[name] = { recorded: recorded[name], current: current[name], delta };
    if (delta > 0) increased.push(name);
    if (delta < 0) decreased.push(name);
  }

  let written = false;
  if (mode === "init") {
    writeRatchet(path, { globs: useGlobs, ...(allow.length > 0 ? { allow } : {}), counters: current });
    written = true;
  } else if (mode === "update" && decreased.length > 0 && recordedFile) {
    /** @type {Counters} */
    const lowered = { ...recordedFile.counters };
    for (const name of COUNTERS) lowered[name] = Math.min(recorded[name], current[name]);
    writeRatchet(path, { ...recordedFile, counters: lowered });
    for (const name of decreased) report[name].recorded = lowered[name];
    written = true;
  }

  const shown = relative(root, path);
  return {
    ok: increased.length === 0,
    mode,
    file: shown.startsWith("..") ? path : shown,
    files,
    globs: useGlobs,
    counters: report,
    increased,
    decreased,
    written,
  };
}
