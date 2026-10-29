#!/usr/bin/env node
// krizaka-workspace-guard: fails when a package of the pnpm workspace depends on another package of the same workspace through a
// registry range instead of `workspace:` (krizaka/.github#388). Run it from the repository root: `krizaka-workspace-guard [root]`.
import { checkWorkspaceRanges, readManifests } from "../workspace-guard/workspace-guard.js";

const root = process.argv[2] ?? process.cwd();
const manifests = readManifests(root);
const bad = checkWorkspaceRanges(manifests);
if (bad.length > 0) {
  console.error(`krizaka-workspace-guard: ${bad.length} dependency(ies) of the workspace without \`workspace:\`:\n${bad.map((b) => `  ${b}`).join("\n")}`);
  process.exit(1);
}
console.log(`krizaka-workspace-guard: ${manifests.length} workspace package(s), every internal dependency uses workspace:`);
