// The files the generator reads, as one map `path -> text` (repo-relative, "/"), whether they come from a checkout on disk or
// from somewhere else (a tarball, a fixture): code, env declarations, manifests and lockfiles. Everything after this file works
// on the map, so the same files give the same view wherever they come from.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

import { parse as parseYaml } from "yaml";

import { asc } from "./order.mjs";
import { readPom } from "./units.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "out",
  "target",
  ".open-next",
  ".expo",
  ".cache",
  ".venv",
]);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|test|tests|e2e|fixtures)\/)/;
const ENV_FILES = /^(?:env\.(?:[cm]?[jt]s)|\.env\.(?:example|sample|template))$/;
const MANIFESTS = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package-lock.json",
  "tsconfig.json",
  "pom.xml",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
]);
const MAX_BYTES = 1_000_000;
// A lockfile of a large workspace is bigger than a source file; it is read whole, up to this size.
const MAX_MANIFEST_BYTES = 16_000_000;

const readCapped = (path, cap) => {
  try {
    return statSync(path).size > cap ? "" : readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

const wanted = (name) => MANIFESTS.has(name) || ENV_FILES.test(name) || CODE.test(name);

/** The files of a checkout the generator reads (code, env declarations, manifests, lockfiles), build folders left out. */
export function filesOfCheckout(root, rel = "", out = new Map()) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) filesOfCheckout(root, path, out);
    } else if (wanted(entry.name)) {
      out.set(path, readCapped(join(root, path), MANIFESTS.has(entry.name) ? MAX_MANIFEST_BYTES : MAX_BYTES));
    }
  }
  return out;
}

const skippedPath = (path) => path.split("/").some((part) => SKIP_DIRS.has(part));
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

/** The code files, the tests and the env declaration files of a map, sorted; build folders left out. */
export function classify(files) {
  const out = { code: [], tests: [], env: [] };
  for (const path of [...files.keys()].filter((p) => !skippedPath(p)).sort(asc)) {
    if (ENV_FILES.test(baseName(path))) out.env.push(path);
    else if (CODE.test(path)) (TEST.test(path) ? out.tests : out.code).push(path);
  }
  return out;
}

export const textOf = (files, path) => files.get(path) ?? "";

export const jsonOf = (files, path) => {
  try {
    return JSON.parse(textOf(files, path));
  } catch {
    return undefined;
  }
};

const yamlPackages = (text) => {
  try {
    const packages = parseYaml(text)?.packages;
    return Array.isArray(packages) ? packages.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
};

const hasPackage = (files, dir) => files.has(posix.join(dir, "package.json"));

/** The direct sub-folders of `rel` that hold a package.json (build folders left out). */
const packageSubdirs = (files, rel) => {
  const prefix = `${rel}/`;
  const found = new Set();
  for (const path of files.keys()) {
    if (!path.startsWith(prefix) || !path.endsWith("/package.json")) continue;
    const parts = path.slice(prefix.length).split("/");
    if (parts.length === 2 && !SKIP_DIRS.has(parts[0])) found.add(`${rel}/${parts[0]}`);
  }
  return [...found];
};

const expand = (files, pattern) => {
  const clean = pattern
    .replace(/^\.\//, "")
    .replace(/\/\*\*$/, "/*")
    .replace(/\/$/, "");
  if (clean.includes("*") && !clean.endsWith("/*")) return [];
  const dirs = clean.endsWith("/*") ? packageSubdirs(files, clean.slice(0, -2)) : [clean];
  return dirs.filter((d) => hasPackage(files, d));
};

/** The directories of the workspace packages (npm/yarn `workspaces` and pnpm-workspace.yaml); [] when the repo is not a workspace. */
export function workspaceDirs(files) {
  const pkg = jsonOf(files, "package.json");
  const declared = Array.isArray(pkg?.workspaces) ? pkg.workspaces : (pkg?.workspaces?.packages ?? []);
  const patterns = [...declared, ...yamlPackages(textOf(files, "pnpm-workspace.yaml"))];
  const excluded = new Set(patterns.filter((p) => p.startsWith("!")).flatMap((p) => expand(files, p.slice(1))));
  return [...new Set(patterns.filter((p) => !p.startsWith("!")).flatMap((p) => expand(files, p)))]
    .filter((d) => !excluded.has(d))
    .sort(asc);
}

/** The Maven modules listed by the root pom (one level), as repo-relative directories that hold a pom.xml. */
export function mavenModules(files) {
  const pom = readPom(textOf(files, "pom.xml"));
  return [...new Set((pom?.modules ?? []).map((m) => posix.normalize(m)))]
    .filter((d) => files.has(posix.join(d, "pom.xml")))
    .sort(asc);
}
