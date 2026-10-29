#!/usr/bin/env node
// krizaka-workspace-guard: fails when a package of the pnpm workspace depends on another package of the same workspace through a
// registry range instead of `workspace:` (krizaka/.github#388). It checks the workspace it is run in (the working directory,
// the repository root): it takes no path, so nothing outside the project is ever read.
import { checkWorkspaceRanges, readManifests } from "../workspace-guard/workspace-guard.js";

const manifests = readManifests(process.cwd());
const bad = checkWorkspaceRanges(manifests);
if (bad.length > 0) {
  const lines = bad.map((b) => "  " + b).join("\n");
  console.error("krizaka-workspace-guard: " + bad.length + " dependency(ies) of the workspace without `workspace:`:\n" + lines);
  process.exit(1);
}
console.log("krizaka-workspace-guard: " + manifests.length + " workspace package(s), every internal dependency uses workspace:");
