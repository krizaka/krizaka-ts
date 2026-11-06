#!/usr/bin/env node
// krizaka-hooks: the ONE git hook chain of every Krizaka repository (ADR-026, krizaka-internal#2746). See the README of @krizaka/config.
//   krizaka-hooks install        point core.hooksPath at the chain (run by `prepare`; idempotent; never fails the install)
//   krizaka-hooks run <hook> …   run one hook (pre-commit | commit-msg | pre-push); git calls it through the installed shims
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runHook } from "../hooks/chain.js";
import { installHooks } from "../hooks/install.js";

const USAGE = `Usage: krizaka-hooks install | run <pre-commit|commit-msg|pre-push> [git arguments…]

install  point this repository's core.hooksPath at the chain (secret scan, co-author check, the declared checks); safe to repeat
run      run one hook; git calls it, you rarely do

Declare a repository's checks in package.json: "krizaka": { "hooks": { "pre-push": [{ "name": "check", "run": "pnpm run check" }] } }`;

const [command, ...rest] = process.argv.slice(2);

if (command === "install") {
  try {
    const result = installHooks({ cwd: process.cwd(), binPath: fileURLToPath(import.meta.url) });
    if (result.status !== "unchanged") {
      const why = result.reason ? " (" + result.reason + ")" : "";
      console.log(`krizaka-hooks: ${result.status}${why}`);
    }
  } catch (error) {
    console.error(
      `krizaka-hooks: install failed, no hook set (${/** @type {Error} */ (error).message}). CI still checks everything.`,
    );
  }
  process.exit(0);
} else if (command === "run" && rest[0]) {
  const [hook, ...args] = rest;
  const input = hook === "pre-push" ? readFileSync(0, "utf8") : "";
  process.exit(await runHook({ hook, args, input, cwd: process.cwd() }));
} else {
  console.error(USAGE);
  process.exit(command === "--help" || command === "-h" ? 0 : 2);
}
