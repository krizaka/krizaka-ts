#!/usr/bin/env node
// krizaka-ratchet — the UI debt can only go down. See the README of @krizaka/config.
import { parseArgs } from "node:util";

import { COUNTERS, RatchetError, runRatchet } from "../ratchet/ratchet.js";

const USAGE = `Usage: krizaka-ratchet [globs…] [--init | --update] [--json] [--root <dir>] [--file <name>]

Counts raw palette colours, light: variants, [var(--…)] utilities and className template strings in the
source files (default: app/**/*.tsx components/**/*.tsx src/**/*.tsx) and compares them with lint-ratchet.json.

  (no flag)  fail (exit 1) when a counter is above its recorded value
  --init     create lint-ratchet.json with the current counters
  --update   lower the recorded counters to the current values (never raises them)
  --json     machine-readable report on stdout (for CI)
  --root     repository root (default: current directory)
  --file     ratchet file name (default: lint-ratchet.json)`;

const LABELS = {
  palette: "raw palette colours",
  light: "light: variants",
  arbitraryVar: "[var(--…)] utilities",
  classNameTemplate: "className template strings",
};

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      init: { type: "boolean" },
      update: { type: "boolean" },
      json: { type: "boolean" },
      root: { type: "string" },
      file: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  console.error(`${error instanceof Error ? error.message : error}\n\n${USAGE}`);
  process.exit(2);
}

const { values, positionals } = args;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.init && values.update) {
  console.error("--init and --update are exclusive.");
  process.exit(2);
}

try {
  const result = await runRatchet({
    root: values.root ?? process.cwd(),
    mode: values.init ? "init" : values.update ? "update" : "check",
    globs: positionals,
    file: values.file,
  });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`krizaka-ratchet — ${result.files} files (${result.globs.join(", ")})`);
    for (const name of COUNTERS) {
      const { recorded, current, delta } = result.counters[name];
      const mark = delta > 0 ? "✗" : delta < 0 ? "↓" : "=";
      const sign = delta > 0 ? `+${delta}` : `${delta}`;
      console.log(`  ${mark} ${LABELS[name].padEnd(28)} ${String(current).padStart(6)}  (recorded ${recorded}, ${sign})`);
    }
    if (result.mode === "init") console.log(`Created ${result.file}.`);
    else if (result.written) console.log(`Lowered ${result.file}: commit it.`);
    else if (result.decreased.length > 0) console.log(`Debt went down: run krizaka-ratchet --update and commit ${result.file}.`);
    if (!result.ok) console.error(`Debt went up (${result.increased.join(", ")}): use the roles of @krizaka/tailwind and cn().`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  if (error instanceof RatchetError || error instanceof SyntaxError) {
    console.error(`krizaka-ratchet: ${error.message}`);
    process.exit(2);
  }
  throw error;
}
