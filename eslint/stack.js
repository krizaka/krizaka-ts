// The three stack rules (the stack ADR, decisions S1–S3 and S11): server state through @krizaka/query, tables and forms
// through @krizaka/ui, TanStack only behind a @krizaka facade. Warnings: krizaka-ratchet counts the same patterns, so an
// app adopts them now and brings each count to 0 by the end of its adoption.
import { krizakaPlugin } from "./plugin.js";

/** The rule names, as configured. */
export const STACK_RULES = Object.freeze([
  "krizaka/no-fetch-in-client-effect",
  "krizaka/no-direct-tanstack-import",
  "krizaka/no-local-table-or-form",
]);

/**
 * Flat config: the three stack rules on an app's sources.
 * @param {{ files?: string[], ignores?: string[], severity?: "warn" | "error", maxFormFields?: number }} [options]
 *   `maxFormFields`: a form with at most this many fields is allowed (default 1 — a search box, a newsletter).
 * @returns {import("eslint").Linter.Config[]}
 */
export function krizakaStack({
  files = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  ignores = [],
  severity = "warn",
  maxFormFields = 1,
} = {}) {
  return [
    {
      name: "krizaka/stack",
      files,
      ...(ignores.length > 0 ? { ignores } : {}),
      plugins: { krizaka: krizakaPlugin },
      rules: {
        "krizaka/no-fetch-in-client-effect": severity,
        "krizaka/no-direct-tanstack-import": severity,
        "krizaka/no-local-table-or-form": [severity, { maxFormFields }],
      },
    },
  ];
}

export default krizakaStack;
