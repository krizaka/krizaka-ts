// The stack rules (the stack ADR, decisions S1–S3): server state through @krizaka/query, tables and forms through
// @krizaka/ui. The import of TanStack (S11) is a dependency-cruiser rule now, `krizaka-first-query`: one tool, one rule.
// Warnings: krizaka-ratchet counts the same patterns, so an app adopts them now and brings each count to 0 by the end
// of its adoption.
import sonarjs from "eslint-plugin-sonarjs";

import { krizakaPlugin } from "./plugin.js";

/** Sonar S3776 threshold: a function above it is a quality-gate failure. Never raised. */
export const COGNITIVE_COMPLEXITY_MAX = 15;

/** The rule names, as configured. */
export const STACK_RULES = Object.freeze([
  "krizaka/no-fetch-in-client-effect",
  "krizaka/no-async-in-effect",
  "krizaka/no-derived-state-in-effect",
  "krizaka/no-local-table-or-form",
  "krizaka/no-family-switcher",
  "krizaka/route-state-selection",
  "sonarjs/cognitive-complexity",
]);

/**
 * Flat config: the stack rules on an app's sources.
 * @param {{ files?: string[], ignores?: string[], severity?: "warn" | "error", effects?: "warn" | "error" | "off", complexity?: "warn" | "error", maxFormFields?: number }} [options]
 *   `effects`: severity of the two effect rules (react-effects standard): `"error"` by default; a repository with debt
 *   passes `"warn"` while `krizaka-ratchet` (asyncInEffect, derivedStateInEffect) brings the count to 0.
 *   `complexity`: severity of `sonarjs/cognitive-complexity` (Sonar S3776, threshold 15): `"error"` by default; a
 *   repository with debt passes `"warn"` while `krizaka-ratchet` (`cognitiveComplexity`) freezes the count and fails any increase.
 *   `maxFormFields`: a form with at most this many fields is allowed (default 1 — a search box, a newsletter).
 * @returns {import("eslint").Linter.Config[]}
 */
export function krizakaStack({
  files = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  ignores = [],
  severity = "warn",
  effects = "error",
  complexity = "error",
  maxFormFields = 1,
} = {}) {
  return [
    {
      name: "krizaka/stack",
      files,
      ...(ignores.length > 0 ? { ignores } : {}),
      plugins: { krizaka: krizakaPlugin, sonarjs },
      rules: {
        "krizaka/no-fetch-in-client-effect": severity,
        // useEffect is for the outside world: data is useQuery/useMutation, derived state is computed in render.
        "krizaka/no-async-in-effect": effects,
        "krizaka/no-derived-state-in-effect": effects,
        "krizaka/no-local-table-or-form": [severity, { maxFormFields }],
        // Never a warning: the family switcher is gone from every site (krizaka.com is the only way back).
        "krizaka/no-family-switcher": "error",
        // A selection of a view (tabs, segmented, toggles, chip groups) lives in the URL, not in local state.
        "krizaka/route-state-selection": severity,
        // Sonar S3776 at lint time (krizaka/.github#319): split the function, never raise the threshold.
        "sonarjs/cognitive-complexity": [complexity, COGNITIVE_COMPLEXITY_MAX],
      },
    },
  ];
}

export default krizakaStack;
