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

// ── The stack debts (decisions S1–S3, S11 of the stack ADR) ──────────────────────────────────────────────────────
// Read by the ESLint rules (eslint/stack.js) and by the ratchet, like the UI patterns above.

/** A `"use client"` directive heading the file (after comments). */
export const USE_CLIENT_SOURCE = String.raw`^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']`;

/** The opening of an effect call: `useEffect(`, `React.useLayoutEffect(`. */
export const EFFECT_CALL_SOURCE = String.raw`\buse(?:Layout)?Effect\s*\(`;

/** A fetch call: `fetch(`, `window.fetch(`, `krizakaFetch(` — never `refetch(`. */
export const FETCH_CALL_SOURCE = String.raw`\b(?:fetch|krizakaFetch)\s*\(`;

/** The names the ESLint rule matches (callee identifier or member property). */
export const EFFECT_NAMES_SOURCE = "^use(Layout)?Effect$";
export const FETCH_NAMES_SOURCE = "^(fetch|krizakaFetch)$";

/** The headless engines that only enter through a `@krizaka/*` package. */
export const TANSTACK_SCOPE = "@tanstack/";

/**
 * An import of one of the given packages (or scopes ending in `/`): `from "x"`, `import "x"`, `import("x")`,
 * `require("x")`, `export … from "x"`.
 * @param {readonly string[]} specifiers package names (`framer-motion`) or scope prefixes (`@tanstack/`)
 * @returns {string} regex source
 */
export function importSource(specifiers) {
  if (specifiers.length === 0) return "(?!)"; // nothing listed: matches nothing
  const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = specifiers.map((s) => (s.endsWith("/") ? `${escape(s)}[^"']+` : `${escape(s)}(?:/[^"']*)?`));
  return String.raw`(?:\bfrom|\bimport|\brequire)\s*(?:\(\s*)?["'](?:${names.join("|")})["']`;
}

/** A `<table` or `<form` element written in an app (JSX or HTML). */
export const TABLE_OR_FORM_SOURCE = String.raw`<(table|form)(?=[\s>/])`;

/** The elements that hold a value in a form: native fields and the field primitives of `@krizaka/ui`. */
export const FORM_FIELD_TAGS = Object.freeze([
  "input", "textarea", "select",
  "Input", "Textarea", "Select", "Combobox", "DatePicker", "DateRangePicker", "TagInput", "Checkbox", "Switch",
  "RadioGroup", "Slider", "SearchField", "Dropzone", "FileUpload", "OtpInput",
]);

/** `<input type="hidden|submit|button|reset|image">` holds no value the user types. */
const NOT_A_FIELD = /\btype=(?:\{\s?)?["'](?:hidden|submit|button|reset|image)["']/;

/**
 * The value-holding fields inside a form's source text.
 * @param {string} text
 * @returns {number}
 */
export function countFormFields(text) {
  const tags = new RegExp(String.raw`<(${FORM_FIELD_TAGS.join("|")})(?=[\s/>])([^>]*)`, "g");
  let fields = 0;
  for (const [, tag, attributes] of text.matchAll(tags)) {
    if (tag === "input" && NOT_A_FIELD.test(attributes ?? "")) continue;
    fields += 1;
  }
  return fields;
}

/**
 * The text between the parenthesis that opens at `open` and the one that closes it, skipping strings and comments.
 * @param {string} source
 * @param {number} open index of the `(`
 * @returns {string}
 */
export function balancedArguments(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === "\\") i += 1;
    } else if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) break;
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1;
      if (i <= 0) break;
    } else if (c === "(") depth += 1;
    else if (c === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

// ── Selections live in the URL (Oussama, 2026-10-22: « changer les tabs doit changer les routes ») ──────────────────────
// Read by the ESLint rule krizaka/route-state-selection and by the ratchet.

/** The selection components whose choice belongs in the URL: tabs, a segmented switch, toggle groups, chip groups, choice tiles. */
export const SELECTION_COMPONENTS = Object.freeze(["Tabs.Root", "TabsRoot", "Chip.Group", "ChipGroup", "ChoiceGrid", "SegmentedControl", "ToggleGroup", "ToggleGroup.Root", "RadioGroup.Root"]);

/** The props that make a selection local: its own value, its starting value, its change handler. */
export const LOCAL_SELECTION_PROPS = Object.freeze(["value", "defaultValue", "onValueChange"]);

/** The prop that binds it to the URL. */
export const ROUTE_KEY_PROP = "routeKey";

/** The justification that keeps a local selection: `// @ephemeral: a hover card's tab` on the line or the line above. */
export const EPHEMERAL_SOURCE = String.raw`@ephemeral:\s*\S`;


/** The opening tags (`<Tabs.Root … >`) of the selection components in a source text, each with the line above it. */
export function selectionTags(/** @type {string} */ source) {
  /** @type {{ tag: string, before: string }[]} */
  const found = [];
  const names = SELECTION_COMPONENTS.map((n) => n.replace(".", "\\.")).join("|");
  for (const open of source.matchAll(new RegExp(`<(?:${names})(?![\\w.])`, "g"))) {
    let depth = 0;
    let end = open.index;
    for (; end < source.length; end += 1) {
      const c = source[end];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    const lineStart = source.lastIndexOf("\n", open.index - 1);
    const before = lineStart < 0 ? "" : source.slice(source.lastIndexOf("\n", lineStart - 1) + 1, lineStart);
    found.push({ tag: source.slice(open.index, end + 1), before });
  }
  return found;
}

/**
 * Is this opening tag a selection driven by local state? `tag` is its source (`<Tabs.Root value={x} onValueChange={set}>`),
 * `before` the text of the line above it.
 * @param {string} tag
 * @param {string} [before]
 */
export function isLocalSelection(tag, before = "") {
  const name = /^<([A-Za-z][\w.]*)/.exec(tag)?.[1];
  if (!name || !SELECTION_COMPONENTS.includes(name)) return false;
  // A radio group is a form field unless it is drawn as a segmented switch (`variant="segmented"`): that one is a view's selection.
  if (name === "RadioGroup.Root" && !/\bvariant\s*=\s*["']segmented["']/.test(tag)) return false;
  const hasProp = (/** @type {string} */ prop) => new RegExp(`\\b${prop}\\s*(=|\\{|\\s|/?>)`).test(tag);
  if (hasProp(ROUTE_KEY_PROP)) return false;
  if (new RegExp(EPHEMERAL_SOURCE).test(tag) || new RegExp(EPHEMERAL_SOURCE).test(before)) return false;
  return LOCAL_SELECTION_PROPS.some((prop) => new RegExp(`\\b${prop}\\s*=`).test(tag));
}
