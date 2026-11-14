// The names `@krizaka/ui` exports as components, read from its published exports — never typed by hand.
// `pnpm run gen:ui-names` rewrites the generated block of `ast-grep/web/no-local-ui-copy.yml` from the installed
// `@krizaka/ui` (package.json `exports` → `registry/<subpath>.json` → the components of each entry); `pnpm test` fails when
// the committed block is not what the installed version gives (`--check`).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RULE = fileURLToPath(new URL("../ast-grep/web/no-local-ui-copy.yml", import.meta.url));
export const BEGIN = "# generated:begin — `pnpm run gen:ui-names`, from the exports of @krizaka/ui";
export const END = "# generated:end";
/** A component: PascalCase with a lowercase letter, no dot (`SiteFooter.Column` is a member), not a constant (`PAPER_GRAIN_ID`). */
const COMPONENT = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/;

const pascal = (/** @type {string} */ s) =>
  s.replace(/(^|-)([a-z0-9])/g, (/** @type {string} */ _, /** @type {string} */ __, /** @type {string} */ c) =>
    c.toUpperCase(),
  );

export function uiPackageDir() {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve("@krizaka/ui/package.json"));
}

/** The sorted component names of the package at `dir`: the registry file of every subpath its `exports` declare. */
export function componentNames(dir = uiPackageDir()) {
  const { exports } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const names = new Set();
  for (const subpath of Object.keys(exports)) {
    const file = join(dir, "registry", `${subpath.replace(/^\.\//, "")}.json`);
    if (!subpath.startsWith("./") || !existsSync(file)) continue;
    const item = JSON.parse(readFileSync(file, "utf8"));
    const found = (item.web?.props ?? [])
      .map((/** @type {{ component: string }} */ p) => p.component)
      .filter((/** @type {string} */ c) => COMPONENT.test(c));
    for (const component of found) names.add(component);
    // the entry's own name (`./tabs` → `Tabs`, `./data-table` → `DataTable`): a compound's namespace is no documented prop.
    if (found.length > 0 && /^\.\/[a-z0-9-]+$/.test(subpath)) names.add(pascal(subpath.slice(2)));
  }
  return [...names].sort();
}

export const block = (/** @type {string[]} */ names) => `${BEGIN}\n    regex: ^(${names.join("|")})$\n    ${END}`;

/** The rule file with its generated block replaced by the one of `names`. */
export function render(/** @type {string} */ source, /** @type {string[]} */ names) {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${RULE}: the generated markers are missing`);
  return source.slice(0, start) + block(names) + source.slice(end + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = readFileSync(RULE, "utf8");
  const next = render(source, componentNames());
  if (process.argv.includes("--check")) {
    if (next !== source) {
      console.error("no-local-ui-copy.yml is not what @krizaka/ui exports: run `pnpm run gen:ui-names`");
      process.exit(1);
    }
  } else writeFileSync(RULE, next);
}
