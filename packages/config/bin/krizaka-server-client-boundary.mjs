#!/usr/bin/env node
// krizaka-server-client-boundary: no server-rendered module calls a function exported by a "use client" Krizaka module (React #441).
import { checkBoundary, DEFAULT_SCOPE } from "../ratchet/server-client-boundary.js";

const USAGE = `Usage: krizaka-server-client-boundary [--root <app folder>] [--app <app router folder>] [--alias <folder of "@/">] [--scope ${DEFAULT_SCOPE}]

Walks what the server renders (pages, layouts, routes and the local modules they import, down to a "use client" file) and fails
when one imports a function (a lowercase export) from a "use client" module of the scope: the server would call a client
reference and the page would crash (React error #441). Render a component, or move the function to a plain module.`;

const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--root") options.root = args[++i];
  else if (arg === "--app") options.appDir = args[++i];
  else if (arg === "--alias") options.alias = args[++i];
  else if (arg === "--scope") options.scope = args[++i];
  else {
    console.error(USAGE);
    process.exit(2);
  }
}
try {
  const { seen, offences } = checkBoundary(options);
  if (offences.length === 0) {
    console.log(
      `krizaka-server-client-boundary: ${seen.size} server modules checked, no client function called from the server.`,
    );
  } else {
    console.error(
      `krizaka-server-client-boundary: ${offences.length} server module(s) import a function from a "use client" module (React #441):`,
    );
    for (const line of offences) console.error(`  ${line}`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
