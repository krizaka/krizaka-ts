#!/usr/bin/env node
// krizaka-known-violations: the known violations of dependency-cruiser, which only shrink.
import { CONFIG_FILE, KNOWN_FILE, runKnownViolations } from "../ratchet/known-violations.js";

const USAGE = `Usage: krizaka-known-violations <check|update|init> [--config ${CONFIG_FILE}] [--known ${KNOWN_FILE}] <folder…>

  check    fails on a violation that is not recorded, and on a recorded one that is fixed (lock the gain with update)
  update   removes the fixed violations from the file; never adds one
  init     writes the file once, for an app that adopts the rules (the adoption pull request)

Run it from the app's folder. Beside it, \`depcruise --ignore-known\` ignores the recorded ones.`;

const args = process.argv.slice(2);
const command = args.shift();
/** @type {{ config?: string, known?: string, targets: string[] }} */
const options = { targets: [] };
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? "";
  if (arg === "--config") options.config = args[++i];
  else if (arg === "--known") options.known = args[++i];
  else options.targets.push(arg);
}

if ((command !== "check" && command !== "update" && command !== "init") || options.targets.length === 0) {
  console.error(USAGE);
  process.exit(2);
}
try {
  const { code, lines } = runKnownViolations(command, options);
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
