// The four debts the UI refactor removes, as regex sources. One definition, read by the ESLint rules
// (eslint/krizaka-ui.js, on className literals) and by the ratchet (bin/krizaka-ratchet.mjs, on the source text).

/** Tailwind palette families a product never writes: a component reads a role (bg-surface-1, text-accent…). */
export const PALETTE_FAMILIES = Object.freeze([
  "zinc", "slate", "gray", "neutral", "stone",
  "fuchsia", "violet", "purple", "pink", "rose",
  "emerald", "green", "amber", "yellow", "red",
  "blue", "sky", "cyan", "indigo",
]);

/** Utilities that take a colour. */
export const COLOR_UTILITIES = Object.freeze(["bg", "text", "border", "from", "via", "to", "ring", "shadow", "fill", "stroke"]);

/**
 * `bg-zinc-900`, `text-violet-400/80`… — a raw palette step.
 * @param {readonly string[]} [allow] families allowed for documented, isolated cases (e.g. `["emerald"]`).
 * @returns {string} regex source
 */
export function paletteSource(allow = []) {
  const families = PALETTE_FAMILIES.filter((family) => !allow.includes(family));
  if (families.length === 0) return "(?!)"; // everything allowed: matches nothing
  return `\\b(${COLOR_UTILITIES.join("|")})-(${families.join("|")})-[0-9]`;
}

/** `light:bg-white` — a theme is a set of tokens, never a variant. */
export const LIGHT_VARIANT_SOURCE = "\\blight:";

/** `bg-[var(--surface-1)]` — the variable has a utility in @krizaka/tailwind. */
export const ARBITRARY_VAR_SOURCE = "\\[var\\(--";

/** `className={`…${x}`}` — the ratchet's text approximation of the TemplateLiteral rule. */
export const CLASSNAME_TEMPLATE_SOURCE = "className=\\{\\s*`";
