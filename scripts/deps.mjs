#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool: its output is the interface */
// dependency-cruiser over every package with sources (the shared preset of @krizaka/config, `.dependency-cruiser.cjs`).
// A package is cruised from its own folder, with its own tsconfig, and keeps its known violations beside it: they only shrink.
//   node scripts/deps.mjs            check: a new violation fails, and so does a recorded one that is fixed
//   node scripts/deps.mjs update     removes the fixed ones from the files (never adds one)
//   node scripts/deps.mjs init       records the violations of a package that has no file yet (the adoption pull request)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The packages with TypeScript sources, and the folders of their sources (`config` is the preset itself: it has none). */
export const PACKAGES = Object.freeze(Object.fromEntries(
  ["api-keys", "audit", "auth", "brief", "credits", "db", "orazaka-client", "org", "organize", "outbox", "payments", "privacy", "rate-limit", "settings", "time", "webhooks"].map((name) => [`packages/${name}`, ["src"]]),
));

/** The packages of the repository that own a `src` folder: a new one cannot escape the cruise (scripts/deps.test.mjs). */
export function packagesWithSources(root = ROOT) {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "src")))
    .map((entry) => `packages/${entry.name}`);
}

function run(command, workspace) {
  const cwd = join(ROOT, workspace);
  const folders = PACKAGES[workspace].filter((folder) => existsSync(join(cwd, folder)));
  const config = join(ROOT, ".dependency-cruiser.cjs");
  // node itself runs the tool by its path (no PATH lookup): the root installs @krizaka/config, and the tool finds depcruise from `cwd`.
  const tool = join(ROOT, "node_modules", "@krizaka", "config", "bin", "krizaka-known-violations.mjs");
  return spawnSync(process.execPath, [tool, command, "--config", config, ...folders], { cwd, stdio: "inherit" }).status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "check";
  if (!["check", "update", "init"].includes(command)) {
    console.error("Usage: node scripts/deps.mjs [check|update|init]");
    process.exit(2);
  }
  let failed = 0;
  for (const workspace of Object.keys(PACKAGES)) {
    console.log(`depcruise ${workspace}`);
    if (run(command, workspace) !== 0) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}
