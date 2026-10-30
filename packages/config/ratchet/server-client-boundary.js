// The server/client boundary of a Next.js app (App Router): a module the server renders must not call a function that a
// `"use client"` module of a Krizaka package exports. Next replaces such an export with a client reference, and calling it on the
// server crashes the page with React error #441 ("Attempted to call readFilterParams() from the server"). Unit tests never see
// it (vitest ignores the directive) and `next build` does not either, so this walks what the server renders: the pages, layouts
// and routes, then every local module they import, stopping at a `"use client"` file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const DEFAULT_SCOPE = "@krizaka";
const ENTRY =
  /(?:^|[\\/])(?:page|layout|route|error|global-error|loading|not-found|default|template)\.(?:ts|tsx|js|jsx|mjs)$/;
// `import … from "x"` / `export … from "x"`: the clause is everything up to the first quote (no nested quantifier: linear).
const STATEMENT = /(?:^|\n)[ \t]*(import|export)\b([^"';]*)["']([^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** @param {string} path */
/** Does the module start with the `"use client"` directive (comments and blank lines may come first)? Scanned, not matched: linear. @param {string} source */
export const isClientSource = (source) => {
  let i = 0;
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return false;
      i = end + 2;
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      if (end < 0) return false;
      i = end + 1;
    } else break;
  }
  const quote = source[i];
  return (quote === '"' || quote === "'") && source.startsWith("use client", i + 1) && source[i + 11] === quote;
};

/** @param {string} path */
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** The `"@/*"` alias of tsconfig.json (read as text: comments and trailing commas are fine); `@/` means the root when there is none. */
/** @param {string} root */
export const readAlias = (root) => {
  try {
    const text = readFileSync(join(root, "tsconfig.json"), "utf8");
    const key = text.indexOf('"@/*"');
    const open = key < 0 ? -1 : text.indexOf('"', text.indexOf("[", key) + 1);
    const target = open < 0 ? "" : text.slice(open + 1, text.indexOf('"', open + 1));
    if (target) return target.replace(/\/?\*$/, "") || ".";
  } catch {
    // no tsconfig, or one we cannot read: the default stands
  }
  return ".";
};

/** The first folder of `candidates` that exists under root. */
/** @param {string} root */
const findApp = (root) => ["app", "src/app"].map((d) => join(root, d)).find((d) => existsSync(d));

/** @param {string} root @param {string} aliasDir @param {string} from @param {string} spec @returns {string | null} */
const resolveLocal = (root, aliasDir, from, spec) => {
  let base = null;
  if (spec.startsWith("@/")) base = join(root, aliasDir, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  if (!base) return null;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  for (const index of ["index.ts", "index.tsx", "index.js"]) if (isFile(join(base, index))) return join(base, index);
  return null;
};

/** @param {string} from @param {string} scope @param {string} name @returns {string | null} */
const findPackageDir = (from, scope, name) => {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", scope, name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
};

/** @param {unknown} target @returns {string | null} */
const pick = (target) => {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  for (const key of ["import", "module", "default", "node", "require"]) {
    const found = pick(/** @type {Record<string, unknown>} */ (target)[key]);
    if (found) return found;
  }
  return null;
};

/** Is the module `spec` of a package a `"use client"` module? Reads the first line of the built entry its `exports` names. */
/** @param {string} root @param {string} spec */
export const packageIsClient = (root, spec) => {
  const [scope, name, ...rest] = spec.split("/");
  const dir = findPackageDir(root, scope, name);
  if (!dir) return false;
  let file;
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const key = rest.length ? `./${rest.join("/")}` : ".";
    file = pick(manifest.exports?.[key]) ?? (rest.length ? null : (manifest.module ?? manifest.main));
  } catch {
    return false;
  }
  if (!file) return false;
  const entry = join(dir, file);
  return isFile(entry) && isClientSource(readFileSync(entry, "utf8"));
};

/**
 * The lowercase (function-like) names a statement's clause brings in as values; a type-only import is erased and harmless.
 * `clause` is the text between `import`/`export` and the quote of the module, e.g. ` { a, type B } from `.
 * @param {string} clause
 * @returns {string[]}
 */
export const functionNames = (clause) => {
  const words = clause.trim().split(/\s+/);
  if (words.at(-1) === "from") words.pop();
  const text = words.join(" ");
  if (text.startsWith("type ") || text.startsWith("type{")) return [];
  const open = text.indexOf("{");
  const close = open < 0 ? -1 : text.indexOf("}", open);
  const names = open < 0 ? [] : bracedNames(text.slice(open + 1, close < 0 ? text.length : close));
  const head = defaultImportName(open < 0 ? text : `${text.slice(0, open)} ${close < 0 ? "" : text.slice(close + 1)}`);
  if (head) names.push(head);
  return names;
};

/** The function-like names inside the braces of an import clause (`type X` entries are erased). @param {string} braces @returns {string[]} */
const bracedNames = (braces) =>
  braces
    .split(",")
    .map((part) => part.trim().split(" "))
    .filter((tokens) => tokens[0] && !(tokens[0] === "type" && tokens.length > 1) && /^[a-z_$]/.test(tokens[0]))
    .map((tokens) => tokens[0]);

/** The default import of what is left outside the braces, when it is function-like: `import readIt from "@krizaka/x"`. @param {string} rest @returns {string | null} */
const defaultImportName = (rest) => {
  const head = rest.replaceAll(",", " ").trim().split(" ")[0] ?? "";
  return head && !head.startsWith("*") && /^[a-z_$]/.test(head) ? head : null;
};

/**
 * Walk what the server renders. `appDirs` defaults to `app` or `src/app`.
 * Returns the visited files and the offences (`file imports a, b from @krizaka/x ("use client")`).
 */
/** @param {{ root?: string, appDir?: string, alias?: string, scope?: string }} [options] @returns {{ seen: Set<string>, offences: string[] }} */
export const checkBoundary = ({ root = process.cwd(), appDir, alias, scope = DEFAULT_SCOPE } = {}) => {
  const app = appDir ? resolve(root, appDir) : findApp(root);
  if (!app) throw new Error(`No app folder under ${root} (looked for app and src/app); pass --app.`);
  const aliasDir = alias ?? readAlias(root);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const offences = [];
  const clientCache = new Map();
  /** @param {string} spec */
  const isClient = (spec) => {
    if (!clientCache.has(spec)) clientCache.set(spec, packageIsClient(root, spec));
    return clientCache.get(spec);
  };
  /** @param {string} file */
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (isClientSource(source)) return;
    for (const match of source.matchAll(STATEMENT)) {
      const [, , clause, spec] = match;
      if (!clause.trimEnd().endsWith("from")) continue; // `import "x"`, or a string in some other statement
      if (spec.startsWith(`${scope}/`)) {
        const names = functionNames(clause);
        if (names.length && isClient(spec))
          offences.push(`${relative(root, file)} imports ${names.join(", ")} from ${spec} ("use client")`);
        continue;
      }
      const local = resolveLocal(root, aliasDir, file, spec);
      if (local && /\.(?:ts|tsx|js|jsx|mjs)$/.test(local)) visit(local);
    }
  };
  for (const entry of walk(app).filter((f) => ENTRY.test(f) && !/\.(?:test|spec)\./.test(f))) visit(entry);
  return { seen, offences };
};
