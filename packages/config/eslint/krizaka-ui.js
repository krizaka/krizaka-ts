// The four non-negotiable UI rules of the refactor (study §2.12), with no plugin: AST selectors on className literals.
// The ratchet (bin/krizaka-ratchet.mjs) counts the same patterns, so a repository can adopt the rules before it is clean.
import { ARBITRARY_VAR_SOURCE, LIGHT_VARIANT_SOURCE, paletteSource } from "../patterns.js";

const CLASSNAME = "JSXAttribute[name.name='className']";

/**
 * The `no-restricted-syntax` entries, for a repository that already uses that rule and must merge both lists
 * (flat config replaces a rule's options, it never concatenates them).
 * @param {{ allow?: string[] }} [options] `allow`: palette families tolerated for documented, isolated cases.
 * @returns {{ selector: string, message: string }[]}
 */
export function krizakaUiRestrictedSyntax({ allow = [] } = {}) {
  return [
    {
      selector: `${CLASSNAME} Literal[value=/${paletteSource(allow)}/]`,
      message:
        "Raw palette colour: use a role (bg-surface-1, text-fg-secondary, border-border-default, text-accent, text-danger).",
    },
    {
      selector: `${CLASSNAME} Literal[value=/${LIGHT_VARIANT_SOURCE}/]`,
      message: "`light:` is forbidden in products: a theme is a set of tokens. A dark island? `.theme-dark` on the ancestor.",
    },
    {
      selector: `${CLASSNAME} Literal[value=/${ARBITRARY_VAR_SOURCE}/]`,
      message: "Arbitrary utility: the variable has a utility in @krizaka/tailwind.",
    },
    {
      selector: `${CLASSNAME} TemplateLiteral`,
      message: "No template string in className: cn(...) merges classes and lets the override win.",
    },
  ];
}

/** The rule set, for a spread into a config object's `rules`. */
export const krizakaUiRules = {
  "no-restricted-syntax": ["error", ...krizakaUiRestrictedSyntax()],
};

/**
 * Flat config: the four UI rules on the given files.
 * @param {{ allow?: string[], files?: string[], ignores?: string[], severity?: "error" | "warn" }} [options]
 * @returns {import("eslint").Linter.Config[]}
 */
export function krizakaUi({
  allow = [],
  files = ["**/*.{jsx,tsx}"],
  ignores = [],
  severity = "error",
} = {}) {
  return [
    {
      name: "krizaka/ui",
      files,
      ...(ignores.length > 0 ? { ignores } : {}),
      rules: { "no-restricted-syntax": [severity, ...krizakaUiRestrictedSyntax({ allow })] },
    },
  ];
}

export default krizakaUi;
