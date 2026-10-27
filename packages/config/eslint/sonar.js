// The Sonar layer (ADR-013, krizaka/.github#333): the whole `eslint-plugin-sonarjs` recommended set, the same engine as
// SonarCloud's JS/TS rules, so a Sonar finding fails at lint time, before push. Under `krizaka-ratchet` (one counter per
// rule): the existing violations of a repository freeze, a new one fails.
import sonarjs from "eslint-plugin-sonarjs";

/** Sonar scans product code, not its tests: the layer and the ratchet counters skip these files. */
export const SONAR_TEST_FILES = Object.freeze(["**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "**/__tests__/**"]);
/** Counted separately (`cognitiveComplexity`, threshold 15 in stack.js): never twice. */
export const SONAR_OWN_COUNTER = "sonarjs/cognitive-complexity";

/**
 * Rules of the recommended set that we turn off, each with its reason. Only a rule that another ESLint rule already
 * enforces, or that contradicts our standards, goes here — never a rule that is merely noisy.
 * @type {Readonly<Record<string, string>>}
 */
export const SONAR_OFF = Object.freeze({
  "sonarjs/no-fallthrough": "duplicate of ESLint core no-fallthrough (@eslint/js recommended)",
  "sonarjs/no-labels": "duplicate of ESLint core no-labels / no-unused-labels",
  "sonarjs/no-unused-vars": "duplicate of @typescript-eslint/no-unused-vars (krizakaBase, `_` prefix convention)",
  "sonarjs/unused-import": "duplicate of @typescript-eslint/no-unused-vars and tsc --noUnusedLocals",
  "sonarjs/no-extra-arguments": "duplicate of the TypeScript compiler (TS2554)",
  "sonarjs/no-empty-character-class": "duplicate of ESLint core no-empty-character-class",
  "sonarjs/no-invalid-regexp": "duplicate of ESLint core no-invalid-regexp",
  "sonarjs/no-control-regex": "duplicate of ESLint core no-control-regex",
  "sonarjs/no-regex-spaces": "duplicate of ESLint core no-regex-spaces",
  "sonarjs/no-misleading-character-class": "duplicate of ESLint core no-misleading-character-class",
  "sonarjs/no-delete-var": "duplicate of ESLint core no-delete-var",
  "sonarjs/no-useless-catch": "duplicate of ESLint core no-useless-catch",
  "sonarjs/updated-const-var": "duplicate of ESLint core no-const-assign and the TypeScript compiler",
  "sonarjs/generator-without-yield": "duplicate of ESLint core require-yield",
  "sonarjs/link-with-target-blank": "duplicate of react/jsx-no-target-blank (eslint-config-next)",
});

/** @type {Record<string, import("eslint").Linter.RuleEntry>} */
const recommended = /** @type {any} */ (sonarjs.configs).recommended.rules;

/**
 * The rules of the layer: every rule the recommended set enables, minus the explicit offs and the cognitive-complexity
 * counter. Name -> its options as shipped by the plugin (severity applied by `sonarRules`).
 * @type {ReadonlyMap<string, unknown[]>}
 */
export const SONAR_RULES = new Map(
  Object.entries(recommended)
    .filter(([name]) => !(name in SONAR_OFF) && name !== SONAR_OWN_COUNTER)
    .flatMap(([name, entry]) => {
      const [level, ...options] = Array.isArray(entry) ? entry : [entry];
      return level === "off" || level === 0 ? [] : [[name, options]];
    }),
);

/**
 * The `rules` object of the layer at one severity.
 * @param {"error" | "warn"} severity
 * @returns {Record<string, import("eslint").Linter.RuleEntry>}
 */
export function sonarRules(severity) {
  return Object.fromEntries([
    ...[...SONAR_RULES].map(([name, options]) => [name, options.length > 0 ? [severity, ...options] : severity]),
    ...Object.keys(SONAR_OFF).map((name) => [name, "off"]),
  ]);
}
