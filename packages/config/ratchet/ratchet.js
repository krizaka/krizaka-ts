// The ratchet: counts the UI and stack debts of a repository and refuses any increase against lint-ratchet.json.
// Same patterns as the ESLint rules (../patterns.js), applied to the source text: the counter sees every
// occurrence (a class in a `cn()` argument or a constant too), so it can only be stricter than the rule.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

import { Linter } from "eslint";
import sonarjs from "eslint-plugin-sonarjs";
import { glob } from "tinyglobby";
import tseslint from "typescript-eslint";

import {
  ARBITRARY_VAR_SOURCE,
  balancedArguments,
  CLASSNAME_TEMPLATE_SOURCE,
  countFormFields,
  EFFECT_CALL_SOURCE,
  effectProblem,
  FETCH_CALL_SOURCE,
  importSource,
  isLocalSelection,
  LIGHT_VARIANT_SOURCE,
  paletteSource,
  selectionTags,
  TABLE_OR_FORM_SOURCE,
  TANSTACK_SCOPE,
  USE_CLIENT_SOURCE,
  withoutDependencyArray,
} from "../patterns.js";

export const RATCHET_FILE = "lint-ratchet.json";
export const DEFAULT_GLOBS = Object.freeze(["app/**/*.tsx", "components/**/*.tsx", "src/**/*.tsx"]);
/** The stack counters read every source file: data hooks and fetchers live in .ts too. */
export const DEFAULT_STACK_GLOBS = Object.freeze(
  ["app", "components", "src", "lib", "hooks", "features"].map((dir) => `${dir}/**/*.{js,jsx,mjs,ts,tsx,mts}`),
);
const IGNORE = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/storybook-static/**", "**/coverage/**"];

/** @typedef {"palette" | "light" | "arbitraryVar" | "classNameTemplate"} UiCounterName */
/** @typedef {"fetchInClientEffect" | "asyncInEffect" | "derivedStateInEffect" | "directTanstackImport" | "localTableOrForm" | "retiredImport" | "routeStateSelection" | "cognitiveComplexity"} StackCounterName */
/** @typedef {UiCounterName | StackCounterName} CounterName */
/** @typedef {Record<CounterName, number>} Counters */
/**
 * @typedef {object} RatchetFile
 * @property {string[]} [globs] files of the UI counters
 * @property {string[]} [stackGlobs] files of the stack counters
 * @property {string[]} [allow] palette families tolerated
 * @property {string[]} [retire] dependencies on their way out: their imports are counted by `retiredImport`
 * @property {number} [maxFormFields] a form with at most this many fields is not counted (default 1)
 * @property {Partial<Counters>} counters
 */

/** The UI counters (the four rules of krizakaUi), in report order. */
export const UI_COUNTERS = /** @type {const} */ (["palette", "light", "arbitraryVar", "classNameTemplate"]);
/** The stack counters (the three rules of krizakaStack, and the dependencies to retire), in report order. */
export const STACK_COUNTERS = /** @type {const} */ ([
  "fetchInClientEffect",
  "asyncInEffect",
  "derivedStateInEffect",
  "directTanstackImport",
  "localTableOrForm",
  "retiredImport",
  "routeStateSelection",
  "cognitiveComplexity",
]);
/** Every counter, in report order. */
export const COUNTERS = /** @type {const} */ ([...UI_COUNTERS, ...STACK_COUNTERS]);
/** Sonar S3776's threshold (same value as eslint/stack.js COGNITIVE_COMPLEXITY_MAX). Never raised. */
const COMPLEXITY_MAX = 15;
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)/;
const zero = () => /** @type {Counters} */ (Object.fromEntries(COUNTERS.map((name) => [name, 0])));

/**
 * @param {string[]} [allow] palette families tolerated (same option as krizakaUi)
 * @returns {Record<UiCounterName, RegExp>}
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
 * Counts the four UI debts in one source text.
 * @param {string} source
 * @param {string[]} [allow]
 * @returns {Record<UiCounterName, number>}
 */
export function countSource(source, allow = []) {
  const patterns = counterPatterns(allow);
  /** @type {Record<UiCounterName, number>} */
  const counters = { palette: 0, light: 0, arbitraryVar: 0, classNameTemplate: 0 };
  for (const name of UI_COUNTERS) counters[name] = source.match(patterns[name])?.length ?? 0;
  return counters;
}

/**
 * Counts the stack debts in one source text: fetch calls inside the effects of a `"use client"` file, imports of
 * `@tanstack/*`, hand-written tables and forms of more than `maxFormFields` fields, imports of the retired dependencies.
 * @param {string} source
 * @param {{ retire?: readonly string[], maxFormFields?: number }} [options]
 * @returns {Record<Exclude<StackCounterName, "cognitiveComplexity">, number>} (cognitiveComplexity: countCognitiveComplexity, it needs the file name)
 */
export function countStackSource(source, { retire = [], maxFormFields = 1 } = {}) {
  let fetchInClientEffect = 0;
  if (new RegExp(USE_CLIENT_SOURCE).test(source)) {
    for (const effect of source.matchAll(new RegExp(EFFECT_CALL_SOURCE, "g"))) {
      const body = balancedArguments(source, (effect.index ?? 0) + effect[0].length - 1);
      fetchInClientEffect += body.match(new RegExp(FETCH_CALL_SOURCE, "g"))?.length ?? 0;
    }
  }
  // react-effects standard: every effect (client file or not — a Vite/Tauri app has no directive) is read once
  let asyncInEffect = 0;
  let derivedStateInEffect = 0;
  for (const effect of source.matchAll(new RegExp(EFFECT_CALL_SOURCE, "g"))) {
    const body = balancedArguments(source, (effect.index ?? 0) + effect[0].length - 1);
    const problem = effectProblem(withoutDependencyArray(body)); // the dependency array is not the callback
    if (problem === "async") asyncInEffect += 1;
    else if (problem === "derived") derivedStateInEffect += 1;
  }
  let localTableOrForm = 0;
  for (const element of source.matchAll(new RegExp(TABLE_OR_FORM_SOURCE, "g"))) {
    if (element[1] === "table") localTableOrForm += 1;
    else {
      const end = source.indexOf("</form>", element.index);
      if (end >= 0 && countFormFields(source.slice(element.index, end)) > maxFormFields) localTableOrForm += 1;
    }
  }
  return {
    fetchInClientEffect,
    asyncInEffect,
    derivedStateInEffect,
    directTanstackImport: source.match(new RegExp(importSource([TANSTACK_SCOPE]), "g"))?.length ?? 0,
    localTableOrForm,
    retiredImport: source.match(new RegExp(importSource(retire), "g"))?.length ?? 0,
    routeStateSelection: selectionTags(source).filter(({ tag, before }) => isLocalSelection(tag, before)).length,
  };
}

/**
 * Counts the functions above Sonar's cognitive-complexity threshold (S3776) in one source text, with the same
 * `sonarjs/cognitive-complexity` rule the ESLint preset uses. A file that does not parse counts for 0 (ESLint reports it).
 * @param {string} source
 * @param {string} [filename]
 * @returns {number}
 */
export function countCognitiveComplexity(source, filename = "file.tsx") {
  const messages = complexityLinter().verify(source, COMPLEXITY_CONFIG, { filename: `file${extname(filename)}` });
  return messages.filter((/** @type {{ ruleId: string | null }} */ m) => m.ruleId === "sonarjs/cognitive-complexity").length;
}

/** One Linter for the whole run: building it (and the parser) per file made the CLI 10x slower in CI. */
/** @type {Linter | undefined} */
let sharedLinter;
const complexityLinter = () => (sharedLinter ??= new Linter());
/** @type {any} */
const COMPLEXITY_CONFIG = [
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: { parser: /** @type {any} */ (tseslint.parser) },
    plugins: { sonarjs },
    rules: { "sonarjs/cognitive-complexity": ["error", COMPLEXITY_MAX] },
  },
];

/**
 * Counts the debts under `root`: the UI counters in the files of `globs`, the stack counters in those of `stackGlobs`.
 * @param {{ root: string, globs?: readonly string[], stackGlobs?: readonly string[], allow?: string[],
 *   retire?: readonly string[], maxFormFields?: number }} options
 * @returns {Promise<{ counters: Counters, files: number, stackFiles: number }>}
 */
export async function countRepository({
  root,
  globs = DEFAULT_GLOBS,
  stackGlobs = DEFAULT_STACK_GLOBS,
  allow = [],
  retire = [],
  maxFormFields = 1,
}) {
  const files = await glob([...globs], { cwd: root, ignore: IGNORE, absolute: true });
  const stackFiles = await glob([...stackGlobs], { cwd: root, ignore: IGNORE, absolute: true });
  const counters = zero();
  for (const file of files) {
    const found = countSource(readFileSync(file, "utf8"), allow);
    for (const name of UI_COUNTERS) counters[name] += found[name];
  }
  for (const file of stackFiles) {
    const found = /** @type {Partial<Counters>} */ (countStackSource(readFileSync(file, "utf8"), { retire, maxFormFields }));
    for (const name of STACK_COUNTERS) counters[name] += found[name] ?? 0;
    // Sonar scans the product code, not its tests
    if (!TEST_FILE.test(file)) counters.cognitiveComplexity += countCognitiveComplexity(readFileSync(file, "utf8"), file);
  }
  return { counters, files: files.length, stackFiles: stackFiles.length };
}

/**
 * @param {string} path
 * @returns {RatchetFile}
 */
function readRatchet(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  for (const name of COUNTERS) {
    const value = data?.counters?.[name];
    // a stack counter may be missing from a file written before it existed: --update records it
    if (value === undefined && STACK_COUNTERS.includes(/** @type {StackCounterName} */ (name))) continue;
    if (!Number.isInteger(value) || value < 0) {
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
 * @property {number} files source files scanned by the UI counters
 * @property {number} stackFiles source files scanned by the stack counters
 * @property {string[]} globs
 * @property {string[]} stackGlobs
 * @property {Record<CounterName, { recorded: number, current: number, delta: number }>} counters
 * @property {CounterName[]} increased
 * @property {CounterName[]} decreased
 * @property {CounterName[]} added counters missing from the file (recorded at their current value by --update)
 * @property {string[]} unmeasured counters of the file this version does not measure: kept as recorded by --update, never dropped
 * @property {boolean} written the ratchet file was created, lowered or completed
 */

/**
 * Each counter against its recorded value: the report, and the names that went up or down.
 * @param {Counters} current
 * @param {Counters} recorded
 */
function compareCounters(current, recorded) {
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
  return { report, increased, decreased };
}

/**
 * Runs the ratchet.
 * - `check` (default): fails when a counter is above its recorded value.
 * - `init`: creates the file with the current counters (refuses to overwrite one).
 * - `update`: lowers each recorded value to the current one, never raises it (still fails on an increase), and records
 *   the counters the file does not have yet at their current value.
 * @param {{ root: string, mode?: "check" | "init" | "update", globs?: string[], file?: string }} options
 * @returns {Promise<RatchetResult>}
 */
export async function runRatchet({ root, mode = "check", globs, file = RATCHET_FILE }) {
  const path = resolve(root, file);
  // the ratchet file is read and written: it stays a .json file inside the repository root (no `../`, no absolute path elsewhere)
  const inside = relative(resolve(root), path);
  if (!path.endsWith(".json") || inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new RatchetError(`${file}: the ratchet file must be a .json file inside ${root}.`);
  }
  const exists = existsSync(path);
  if (mode === "init" && exists) throw new RatchetError(`${file} already exists: use --update to lower it.`);
  if (mode !== "init" && !exists) throw new RatchetError(`${file} not found in ${root}: run krizaka-ratchet --init first.`);

  const recordedFile = exists ? readRatchet(path) : undefined;
  const useGlobs = globs && globs.length > 0 ? globs : (recordedFile?.globs ?? [...DEFAULT_GLOBS]);
  const stackGlobs = recordedFile?.stackGlobs ?? [...DEFAULT_STACK_GLOBS];
  const allow = recordedFile?.allow ?? [];
  const retire = recordedFile?.retire ?? [];
  const maxFormFields = recordedFile?.maxFormFields ?? 1;
  const { counters: current, files, stackFiles } = await countRepository({
    root,
    globs: useGlobs,
    stackGlobs,
    allow,
    retire,
    maxFormFields,
  });
  /** @type {CounterName[]} */ const added = recordedFile ? COUNTERS.filter((n) => recordedFile.counters[n] === undefined) : [];
  const recorded = /** @type {Counters} */ ({ ...current, ...recordedFile?.counters });
  /** @type {string[]} */
  const unmeasured = Object.keys(recordedFile?.counters ?? {}).filter((n) => !COUNTERS.includes(/** @type {CounterName} */ (n)));

  const { report, increased, decreased } = compareCounters(current, recorded);

  let written = false;
  if (mode === "init") {
    writeRatchet(path, { globs: useGlobs, stackGlobs, ...(allow.length > 0 ? { allow } : {}), counters: current });
    written = true;
  } else if (mode === "update" && (decreased.length > 0 || added.length > 0) && recordedFile) {
    const lowered = zero();
    for (const name of COUNTERS) lowered[name] = Math.min(recorded[name], current[name]);
    // a counter this version does not measure (a repository's own, or a newer preset's) is kept as recorded, never dropped
    const counters = { ...lowered, ...Object.fromEntries(unmeasured.map((name) => [name, /** @type {Record<string, number>} */ (recordedFile?.counters)?.[name]])) };
    writeRatchet(path, { ...recordedFile, stackGlobs: recordedFile.stackGlobs ?? stackGlobs, counters });
    for (const name of decreased) report[name].recorded = lowered[name];
    written = true;
  }

  const shown = relative(root, path);
  return {
    ok: increased.length === 0,
    mode,
    file: shown.startsWith("..") ? path : shown,
    files,
    stackFiles,
    globs: useGlobs,
    stackGlobs,
    counters: report,
    increased,
    decreased,
    added,
    unmeasured,
    written,
  };
}
