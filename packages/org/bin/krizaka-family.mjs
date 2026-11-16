#!/usr/bin/env node
// krizaka-family — render and check the surfaces that show the Krizaka family (krizaka-internal#3914, slice 2 of #3910).
//   krizaka-family render <org-profile|member-readme|repo-readme|founder-profile|founder-bio|social-bios> [--lang en|fr]
//   krizaka-family check  <surface> <file> [--lang en|fr]
// `render` prints the block between `<!-- krizaka:family:start -->` and `<!-- krizaka:family:end -->` (or the bio text).
// `check` extracts what the file shows of the surface and prints the diff with the expected view; exit 1 on a drift.
import { readFileSync } from "node:fs";

import { checkSurface, renderSurface, SURFACES } from "../dist/index.js";

const usage = () => {
  console.error(
    `usage: krizaka-family render <${SURFACES.join("|")}> [--lang en|fr]\n       krizaka-family check <surface> <file> [--lang en|fr]`,
  );
  process.exit(2);
};

const args = process.argv.slice(2);
const at = args.indexOf("--lang");
const lang = at < 0 ? "en" : args.splice(at, 2)[1];
const [command, surface, file] = args;
if (!SURFACES.includes(surface) || !["en", "fr"].includes(lang)) usage();

if (command === "render" && args.length === 2) {
  console.log(renderSurface(surface, lang));
} else if (command === "check" && args.length === 3) {
  const result = checkSurface(surface, readFileSync(file, "utf8"), lang);
  if (!result.ok) {
    console.error(`${surface} in ${file} drifts from the family table (- expected, + shown):\n${result.diff}`);
    process.exit(1);
  }
  console.log(`${surface} in ${file} matches the family table.`);
} else usage();
