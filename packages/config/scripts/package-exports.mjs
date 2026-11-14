// What the `@krizaka/*` packages of this repository give an app, read from their sources and their package.json — never typed:
//   - the names they export (functions, classes, types, constants) → the generated block of `ast-grep/app/no-local-lib-copy.yml`;
//   - the third-party libraries they wrap (`"krizaka": { "facade": { "wraps": [...], "use": "..." } }` in the package's own
//     package.json) → `facades.json`, merged with `covered-domains.json` into the dependency-cruiser « Krizaka first » rules.
// `pnpm run gen:package-exports` rewrites both; `pnpm test` fails when a committed file is not what the packages give (`--check`).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULE = join(HERE, "../ast-grep/app/no-local-lib-copy.yml");
const FACADES = join(HERE, "../facades.json");
const PACKAGES = resolve(HERE, "../..");
export const BEGIN = "# generated:begin — `pnpm run gen:package-exports`, from the exports of the @krizaka packages";
export const END = "# generated:end";
/** A name worth refusing: two words at least (`createOutbox`, `OrganizeError`), so `Query`, `Clock` or `Item` stay free. */
const DISTINCTIVE = /^[A-Za-z][a-z0-9]+[A-Z][A-Za-z0-9]*$/;
const isDistinctive = (/** @type {string} */ name) => name.length >= 8 && DISTINCTIVE.test(name);

const SOURCE_EXT = [".ts", ".tsx", ".mts"];

/** The source file of a package entry (`./dist/outbox.js` → `src/outbox.ts`), or null. */
function sourceOf(/** @type {string} */ dir, /** @type {string} */ target) {
  const base = target.replace(/^\.\/(dist|src)\//, "").replace(/\.(d\.ts|d\.mts|js|mjs|cjs)$/, "");
  for (const ext of SOURCE_EXT) {
    const file = join(dir, "src", base + ext);
    if (existsSync(file)) return file;
  }
  return null;
}

/** The entry files of a package: every string target of its `exports` that has a source. */
function entryFiles(/** @type {string} */ dir, /** @type {unknown} */ exports) {
  const files = new Set();
  const walk = (/** @type {unknown} */ node) => {
    if (typeof node === "string") {
      const file = node.endsWith(".json") ? null : sourceOf(dir, node);
      if (file) files.add(file);
    } else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(exports);
  return [...files];
}

const isExported = (/** @type {ts.Statement} */ node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The file `export * from "./x"` points to, or undefined. */
function relativeTarget(/** @type {string} */ file, /** @type {string} */ specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const stem = resolve(dirname(file), specifier.replace(/\.(js|mjs)$/, ""));
  return [...SOURCE_EXT.map((e) => stem + e), ...SOURCE_EXT.map((e) => join(stem, `index${e}`))].find(existsSync);
}

const DECLARATIONS = [
  ts.isFunctionDeclaration,
  ts.isClassDeclaration,
  ts.isInterfaceDeclaration,
  ts.isTypeAliasDeclaration,
];

/** The names an `export const a = …, b = …` or `export function f` statement declares. */
function declaredNames(/** @type {ts.Statement} */ node) {
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  const named = /** @type {{ name?: ts.Identifier }} */ (node);
  return DECLARATIONS.some((is) => is(node)) && named.name ? [named.name.text] : [];
}

/**
 * The names an `export { a, b }` or `export * from "./x"` statement gives; the star is followed into the other file.
 * @returns {string[]}
 */
function reExportedNames(
  /** @type {ts.ExportDeclaration} */ node,
  /** @type {string} */ file,
  /** @type {Set<string>} */ seen,
) {
  if (node.exportClause)
    return ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => e.name.text) : [];
  const specifier = node.moduleSpecifier;
  const next = specifier && ts.isStringLiteral(specifier) ? relativeTarget(file, specifier.text) : undefined;
  return next ? exportedFrom(next, seen) : [];
}

/**
 * The names a file exports; `export * from "./x"` is followed, and a name only re-exported counts too.
 * @returns {string[]}
 */
export function exportedFrom(/** @type {string} */ file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return [];
  seen.add(file);
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  return tree.statements.flatMap((node) => {
    if (ts.isExportDeclaration(node)) return reExportedNames(node, file, seen);
    return isExported(node) ? declaredNames(node) : [];
  });
}

/** The packages under `root`: `{ dir, id, json }` for every folder with a package.json, the config package left out. */
function packages(/** @type {string} */ root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "config" && existsSync(join(root, d.name, "package.json")))
    .map((d) => {
      const dir = join(root, d.name);
      return { dir, id: d.name, json: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The sorted distinctive names exported by the packages under `root`. */
export function exportedNames(root = PACKAGES) {
  const names = new Set();
  for (const { dir, json } of packages(root))
    for (const file of entryFiles(dir, json.exports ?? {}))
      for (const name of exportedFrom(file)) if (isDistinctive(name)) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The facade domains declared by the packages: `{ id, title, home, use, refused }`, the shape of `covered-domains.json`.
 * A package without `krizaka.facade` wraps nothing; one that declares it without `wraps` and `use` is an error.
 */
export function facadeDomains(root = PACKAGES) {
  const domains = [];
  for (const { id, json } of packages(root)) {
    const facade = json.krizaka?.facade;
    if (!facade) continue;
    if (!Array.isArray(facade.wraps) || facade.wraps.length === 0 || typeof facade.use !== "string")
      throw new Error(`${json.name}: krizaka.facade needs \`wraps\` (a list) and \`use\` (a sentence)`);
    domains.push({
      id,
      title: facade.title ?? json.name,
      home: json.name,
      use: facade.use,
      refused: [...facade.wraps].sort((a, b) => a.localeCompare(b)),
    });
  }
  return domains;
}

export const block = (/** @type {string[]} */ names) => `${BEGIN}\n    regex: ^(${names.join("|")})$\n    ${END}`;

/** The rule file with its generated block replaced by the one of `names`. */
export function render(/** @type {string} */ source, /** @type {string[]} */ names) {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${RULE}: the generated markers are missing`);
  return source.slice(0, start) + block(names) + source.slice(end + END.length);
}

const FACADES_COMMENT =
  "GENERATED by `pnpm run gen:package-exports` from the `krizaka.facade` of each package.json — never edited by hand.";
const inlineStrings = (/** @type {string} */ _, /** @type {string} */ items) => `[${items.replace(/",\s+"/g, '", "')}]`;

/** The committed file, laid out as Prettier does: a list of strings stays on one line. */
export function facadesFile(/** @type {unknown[]} */ domains) {
  const json = JSON.stringify({ $comment: FACADES_COMMENT, domains }, null, 2);
  return `${json.replace(/\[\s+("[^\]]*?")\s+\]/g, inlineStrings)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rule = readFileSync(RULE, "utf8");
  const nextRule = render(rule, exportedNames());
  const nextFacades = facadesFile(facadeDomains());
  if (process.argv.includes("--check")) {
    const current = existsSync(FACADES) ? readFileSync(FACADES, "utf8") : "";
    if (nextRule !== rule || current !== nextFacades) {
      console.error(
        "no-local-lib-copy.yml or facades.json is not what the packages give: run `pnpm run gen:package-exports`",
      );
      process.exit(1);
    }
  } else {
    writeFileSync(RULE, nextRule);
    writeFileSync(FACADES, nextFacades);
  }
}
