// The server/client boundary of a Next.js app (App Router): a module the server renders must not call a function that a
// `"use client"` module of a Krizaka package exports. Next replaces such an export with a client reference, and calling it on the
// server crashes the page with React error #441 ("Attempted to call readFilterParams() from the server"). Unit tests never see
// it (vitest ignores the directive) and `next build` does not either, so this walks what the server renders: the pages, layouts
// and routes, then every local module they import, stopping at a `"use client"` file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const DEFAULT_SCOPE = "@krizaka";
const ENTRY = /(?:^|[\\/])(?:page|layout|route|error|global-error|loading|not-found|default|template)\.(?:ts|tsx|js|jsx|mjs)$/;
const CLIENT = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/;
const IMPORT = /^(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** @param {string} path */
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** The `"@/*"` alias of tsconfig.json (comments tolerated); `@/` means the root when there is none. */
/** @param {string} root */
export const readAlias = (root) => {
  try {
    const text = readFileSync(join(root, "tsconfig.json"), "utf8").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
    const target = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")).compilerOptions?.paths?.["@/*"]?.[0];
    if (typeof target === "string") return target.replace(/\/?\*$/, "") || ".";
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
  const base = spec.startsWith("@/") ? join(root, aliasDir, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
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
    file = pick(manifest.exports?.[key]) ?? (rest.length ? null : manifest.module ?? manifest.main);
  } catch {
    return false;
  }
  if (!file) return false;
  const entry = join(dir, file);
  return isFile(entry) && CLIENT.test(readFileSync(entry, "utf8"));
};

/** The lowercase (function-like) names a statement brings in as values; a type-only import is erased and harmless. */
/** @param {string} clause @returns {string[]} */
export const functionNames = (clause) => {
  /** @type {string[]} */
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
  for (const part of braces.split(",")) {
    const text = part.trim();
    if (!text || text.startsWith("type ")) continue;
    const name = text.split(/\s+as\s+/)[0].trim();
    if (/^[a-z_$]/.test(name) || name === "default") names.push(name);
  }
  const head = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  if (head && !head.startsWith("*") && /^[a-z_$]/.test(head)) names.push(head); // default import: `import readIt from "@krizaka/x"`
  return names;
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
    if (CLIENT.test(source)) return;
    for (const match of source.matchAll(IMPORT)) {
      if (match[2]) continue; // import type
      const [, , , clause, spec] = match;
      if (spec.startsWith(`${scope}/`)) {
        const names = functionNames(clause);
        if (names.length && isClient(spec)) offences.push(`${relative(root, file)} imports ${names.join(", ")} from ${spec} ("use client")`);
        continue;
      }
      const local = resolveLocal(root, aliasDir, file, spec);
      if (local && /\.(?:ts|tsx|js|jsx|mjs)$/.test(local)) visit(local);
    }
  };
  for (const entry of walk(app).filter((f) => ENTRY.test(f) && !/\.(?:test|spec)\./.test(f))) visit(entry);
  return { seen, offences };
};
