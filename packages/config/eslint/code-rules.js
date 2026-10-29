// The code rules (krizaka/.github#422, founder review 2026-10-29): readable shapes, enforced by lint and frozen by the
// ratchet (`code/<rule>` counters, like the Sonar layer). Braces always, at most two levels of nesting in a function, at
// most three nested callbacks, and no scattered `console.*` in runtime code (logs go through the shared logger).
// Above `max-depth`, extract a named function or write a `flatMap` / `filter` / `map` pipeline that returns the result.

/** The ESLint rules of the layer and their options. `no-console` is applied to runtime files only (see `isRuntimeFile`). */
export const CODE_RULES = Object.freeze({
  curly: ["all"],
  "max-depth": [2],
  "max-nested-callbacks": [3],
});
/** Runtime-only rule: scripts, tools, configs and tests print through `console` legitimately. */
export const CODE_RUNTIME_RULES = Object.freeze({ "no-console": [] });

/** Prefix of the per-rule counters of the ratchet: `code/max-depth`. */
export const CODE_PREFIX = "code/";

/** Files that serve requests or ship to users: app code, `src`, `lib`, a package's or app's `src`. Not scripts, tools, configs, tests. */
export const RUNTIME_GLOBS = Object.freeze([
  "app/**",
  "src/**",
  "lib/**",
  "components/**",
  "hooks/**",
  "features/**",
  "server/**",
  "packages/*/src/**",
  "apps/*/src/**",
  "apps/*/lib/**",
  "apps/*/app/**",
]);
/** Not runtime even under a runtime folder. */
export const NON_RUNTIME_GLOBS = Object.freeze([
  "**/*.{test,spec,stories}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "**/__tests__/**",
  "**/tests/**",
  "**/scripts/**",
  "**/tools/**",
  "**/*.config.*",
]);

const RUNTIME = RUNTIME_GLOBS.map((glob) => new RegExp(`^${globToSource(glob)}`));
const NOT_RUNTIME = [/\.(test|spec|stories)\.[cm]?[jt]sx?$/, /(^|\/)(__tests__|tests|scripts|tools)\//, /\.config\./];

/** @param {string} glob */
function globToSource(glob) {
  return glob.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*");
}

/**
 * True when a repository-relative path is runtime code (the scope of `no-console`).
 * @param {string} path
 */
export function isRuntimeFile(path) {
  const normal = path.replaceAll("\\", "/");
  return RUNTIME.some((pattern) => pattern.test(normal)) && !NOT_RUNTIME.some((pattern) => pattern.test(normal));
}

/**
 * Flat config: the code rules.
 * @param {{ severity?: "warn" | "error" | "off", files?: string[] }} [options]
 *   `severity`: `"error"` by default; a repository with debt passes `"warn"` while `krizaka-ratchet` (`code/<rule>` counters)
 *   freezes each count and fails any increase. Tests are held to the braces rule only.
 * @returns {import("eslint").Linter.Config[]}
 */
export function krizakaCodeRules({ severity = "error", files = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"] } = {}) {
  if (severity === "off") {
    return [];
  }
  const entry = (/** @type {Record<string, unknown[]>} */ rules) =>
    /** @type {any} */ (
      Object.fromEntries(Object.entries(rules).map(([name, options]) => [name, [severity, ...options]]))
    );
  return [
    { name: "krizaka/code-rules", files, rules: entry(CODE_RULES) },
    {
      name: "krizaka/code-rules-runtime",
      files: [...RUNTIME_GLOBS].map((glob) => `${glob}/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`),
      ignores: [...NON_RUNTIME_GLOBS],
      rules: entry(CODE_RUNTIME_RULES),
    },
  ];
}

export default krizakaCodeRules;
