#!/usr/bin/env node
// A package.json changed without its lockfile is refused (krizaka-internal#3610): the lockfile of the pnpm workspace and the
// package-lock.json of the documentation site (site/) must record what their package.json asks, or `pnpm install --frozen-lockfile`
// / `npm ci` fails in CI and the release cannot land. Runs in `pnpm run lint` (pre-push and CI). Nothing is installed: both
// package managers validate the lock before they fetch, and `--lockfile-only` / `--dry-run` fetch nothing into node_modules.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The command that proves a lockfile matches its manifests, by lockfile name. */
const CHECKS = {
  "pnpm-lock.yaml": {
    cmd: "pnpm",
    args: ["install", "--frozen-lockfile", "--lockfile-only", "--ignore-scripts"],
    fix: "pnpm install",
  },
  "package-lock.json": {
    cmd: "npm",
    args: ["ci", "--dry-run", "--ignore-scripts"],
    fix: "npm install --package-lock-only",
  },
};

/**
 * Checks the lockfile of one folder.
 * @param {string} dir a folder with a package.json and one of the known lockfiles
 * @returns {{ ok: boolean, lockfile: string, output: string, fix: string } | null} null when the folder has no known lockfile
 */
export function checkLockfile(dir) {
  for (const [lockfile, { cmd, args, fix }] of Object.entries(CHECKS)) {
    if (!existsSync(join(dir, lockfile))) continue;
    const run = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", env: { ...process.env, CI: "true" } });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}${run.error?.message ?? ""}`.trim();
    return { ok: run.status === 0, lockfile, output, fix };
  }
  return null;
}

/** The folders whose lockfile is checked: the workspace root and the documentation site. */
export const LOCKED_FOLDERS = [".", "site"];

function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let failed = false;
  for (const folder of LOCKED_FOLDERS) {
    const result = checkLockfile(join(root, folder));
    if (result === null) continue;
    if (result.ok) {
      console.log(`check-lockfiles: ${folder}/${result.lockfile} matches its package.json`);
      continue;
    }
    failed = true;
    console.error(
      `check-lockfiles: ${folder}/${result.lockfile} does not match ${folder}/package.json.\n${result.output}\nRun \`${result.fix}\` in ${folder}/ and commit the lockfile.`,
    );
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
