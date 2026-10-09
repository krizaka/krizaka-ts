// The base flat config of every Krizaka JavaScript repository: @eslint/js and typescript-eslint recommended,
// the React hooks rules, and a light import ordering (autofixable, a warning).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Generated or vendored output, never linted. */
export const KRIZAKA_IGNORES = Object.freeze([
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/out/**",
  "**/.turbo/**",
  "**/.expo/**",
  "**/storybook-static/**",
  "**/next-env.d.ts",
]);

/**
 * Shared by krizakaBase and krizakaNext: ignores, globals, import ordering.
 * @type {import("eslint").Linter.Config[]}
 */
export const krizakaCommon = [
  { name: "krizaka/ignores", ignores: [...KRIZAKA_IGNORES] },
  {
    name: "krizaka/language",
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    name: "krizaka/imports",
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
    },
  },
];

/**
 * Unused variables are errors, except the `_`-prefixed ones (an intentionally ignored argument).
 * @type {import("eslint").Linter.RuleEntry}
 */
const UNUSED_VARS = [
  "error",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
];

/** @type {import("eslint").Linter.Config[]} */
export const krizakaBase = [
  ...krizakaCommon,
  { name: "krizaka/js", ...js.configs.recommended },
  .../** @type {import("eslint").Linter.Config[]} */ (tseslint.configs.recommended),
  { name: "krizaka/react-hooks", files: ["**/*.{js,jsx,ts,tsx}"], ...reactHooks.configs.flat.recommended },
  {
    name: "krizaka/typescript",
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: { "@typescript-eslint/no-unused-vars": UNUSED_VARS },
  },
];

export default krizakaBase;
