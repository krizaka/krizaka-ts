// Reading a checkout: the files worth looking at and the workspace layout. Node built-ins only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

import { asc } from "./order.mjs";

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
const MAX_BYTES = 1_000_000;

export const readText = (path) => {
  try {
    return statSync(path).size > MAX_BYTES ? "" : readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

export const readJson = (path) => {
  try {
    return JSON.parse(readText(path));
  } catch {
    return undefined;
  }
};

/** Every code file and env declaration file of a checkout, as repo-relative paths with "/". Tests are listed apart. */
const listing = () => ({ code: [], tests: [], env: [] });

export function walk(root, rel = "", out = listing()) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, path, out);
    } else if (ENV_FILES.test(entry.name)) {
      out.env.push(path);
    } else if (CODE.test(entry.name)) {
      (TEST.test(path) ? out.tests : out.code).push(path);
    }
  }
  return out;
}

const yamlPackages = (yaml) => {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start < 0) return [];
  const found = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s*-\s*['"]?([^'"#\s]+)['"]?/.exec(line);
    if (m) found.push(m[1]);
    else if (/^\S/.test(line)) break;
  }
  return found;
};

const subdirs = (root, rel) => {
  try {
    return readdirSync(join(root, rel), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
      .map((e) => posix.join(rel, e.name));
  } catch {
    return [];
  }
};

const expand = (root, pattern) => {
  const clean = pattern
    .replace(/^\.\//, "")
    .replace(/\/\*\*$/, "/*")
    .replace(/\/$/, "");
  if (clean.includes("*") && !clean.endsWith("/*")) return [];
  const dirs = clean.endsWith("/*") ? subdirs(root, clean.slice(0, -2)) : [clean];
  return dirs.filter((d) => existsSync(join(root, d, "package.json")));
};

/** The directories of the workspace packages (npm/yarn `workspaces` and pnpm-workspace.yaml); [] when the repo is not a workspace. */
export function workspaceDirs(root) {
  const pkg = readJson(join(root, "package.json"));
  const declared = Array.isArray(pkg?.workspaces) ? pkg.workspaces : (pkg?.workspaces?.packages ?? []);
  const patterns = [...declared, ...yamlPackages(readText(join(root, "pnpm-workspace.yaml")))];
  const excluded = new Set(patterns.filter((p) => p.startsWith("!")).flatMap((p) => expand(root, p.slice(1))));
  return [...new Set(patterns.filter((p) => !p.startsWith("!")).flatMap((p) => expand(root, p)))]
    .filter((d) => !excluded.has(d))
    .sort(asc);
}

/** The Maven modules listed by the root pom (one level), as repo-relative directories. */
export function mavenModules(root) {
  const pom = readText(join(root, "pom.xml"));
  return [...pom.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)]
    .map((m) => posix.normalize(m[1]))
    .filter((d) => existsSync(join(root, d, "pom.xml")))
    .sort(asc);
}
