// The pnpm workspace guard (krizaka/.github#388): a dependency that names another package of the same workspace is written
// `workspace:`, never a registry range. A registry range goes stale as soon as the dependency is versioned (`^0.1.0` against 0.4.0):
// `changeset version` then fails and no Version Packages pull request is ever opened.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/**
 * The `packages:` globs of a pnpm-workspace.yaml (the list under the key, `!` exclusions skipped).
 * @param {string} yaml
 * @returns {string[]}
 */
export function workspaceGlobs(yaml) {
  /** @type {string[]} */
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) inPackages = true;
    else if (/^\S/.test(line)) inPackages = false;
    else if (inPackages) {
      const item = /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(line);
      if (item && !item[1].startsWith("!")) globs.push(item[1]);
    }
  }
  return globs;
}

/**
 * The folders a glob names: `apps/*`, `packages/**` (one level, as pnpm resolves them) or a plain folder.
 * @param {string} root
 * @param {string} glob
 * @returns {string[]}
 */
function foldersOf(root, glob) {
  const parts = glob.replace(/\/\*{1,2}$/, "");
  if (parts === glob) return existsSync(join(root, glob, "package.json")) ? [glob] : [];
  const base = join(root, parts);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "package.json")))
    .map((e) => `${parts}/${e.name}`);
}

/**
 * The manifests of the workspace: every package folder.
 * @param {string} root
 * @returns {Array<Record<string, any>>}
 */
export function readManifests(root) {
  const yamlPath = join(root, "pnpm-workspace.yaml");
  const globs = existsSync(yamlPath) ? workspaceGlobs(readFileSync(yamlPath, "utf8")) : [];
  const folders = [...new Set(globs.flatMap((g) => foldersOf(root, g)))];
  return folders.map((f) => JSON.parse(readFileSync(join(root, f, "package.json"), "utf8")));
}

/**
 * Every dependency that names a package of the workspace without `workspace:` (peer ranges are a published contract and stay).
 * @param {Array<Record<string, any>>} manifests
 * @returns {string[]}
 */
export function checkWorkspaceRanges(manifests) {
  const own = new Set(manifests.map((m) => m.name).filter(Boolean));
  /** @type {string[]} */
  const bad = [];
  for (const m of manifests) {
    for (const field of FIELDS) {
      for (const [name, range] of Object.entries(m[field] ?? {})) {
        if (own.has(name) && !String(range).startsWith("workspace:"))
          bad.push(`${m.name} -> ${name}@${range} (${field})`);
      }
    }
  }
  return bad;
}
