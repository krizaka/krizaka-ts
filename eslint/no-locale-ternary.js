// A component never chooses its text with `locale === "fr" ? … : …`: every user-facing string lives in the
// message catalogues. Only routing code compares locales. Same selectors as the rule in force on krizaka.com,
// shipped as a plugin rule (`krizaka/no-locale-ternary`) so it never collides with a repository's own
// `no-restricted-syntax` options.

const MESSAGE = "Put the text in the message catalogues (messages/<locale>.json) and read it from the dictionary (t.…).";

/** The selectors, also usable in `no-restricted-syntax`. */
export const LOCALE_TERNARY_SELECTORS = Object.freeze([
  "ConditionalExpression[test.type='BinaryExpression'][test.right.value=/^(fr|en)$/]",
  "ConditionalExpression > Identifier.test[name=/^(isFr|isEn|fr)$/]",
]);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Forbid choosing a text with a locale ternary outside routing code." },
    schema: [],
    messages: { localeTernary: MESSAGE },
  },
  create(context) {
    /** @type {Record<string, (node: import("estree").Node) => void>} */
    const visitors = {};
    for (const selector of LOCALE_TERNARY_SELECTORS) {
      visitors[selector] = (node) => context.report({ node, messageId: "localeTernary" });
    }
    return visitors;
  },
};

/** The plugin carrying the rule. */
export const krizakaPlugin = {
  meta: { name: "@krizaka/config" },
  rules: { "no-locale-ternary": rule },
};

/** Routing files that legitimately compare locales (the krizaka.com layout, a common convention). */
export const DEFAULT_ROUTING_FILES = Object.freeze([
  "**/proxy.ts",
  "**/middleware.ts",
  "**/i18n.ts",
  "**/seo.ts",
  "**/app/[[]locale[]]/layout.tsx",
  "**/I18nProvider.tsx",
]);

/**
 * Flat config: `krizaka/no-locale-ternary` on the given files, except routing code.
 * @param {{ files?: string[], routing?: string[] }} [options] `routing`: files allowed to compare locales.
 * @returns {import("eslint").Linter.Config[]}
 */
export function noLocaleTernary({
  files = ["**/*.{js,jsx,ts,tsx}"],
  routing = [...DEFAULT_ROUTING_FILES],
} = {}) {
  return [
    {
      name: "krizaka/no-locale-ternary",
      files,
      ignores: routing,
      plugins: { krizaka: krizakaPlugin },
      rules: { "krizaka/no-locale-ternary": "error" },
    },
  ];
}

export default noLocaleTernary;
