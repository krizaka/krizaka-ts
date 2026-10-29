import assert from "node:assert/strict";

import { test } from "vitest";

import { checkWorkspaceRanges, workspaceGlobs } from "../workspace-guard/workspace-guard.js";

test("the globs are the list under packages:, exclusions skipped", () => {
  const yaml = 'packages:\n  - "apps/*"\n  - packages/*\n  - "!packages/legacy"\nonlyBuiltDependencies:\n  - esbuild\n';
  assert.deepEqual(workspaceGlobs(yaml), ["apps/*", "packages/*"]);
});

test("an internal dependency must use workspace:", () => {
  const manifests = [
    { name: "@a/ui", dependencies: { "@a/core": "^0.1.0", react: "^19.0.0" } },
    { name: "@a/core", devDependencies: { "@a/ui": "workspace:*" } },
  ];
  assert.deepEqual(checkWorkspaceRanges(manifests), ["@a/ui -> @a/core@^0.1.0 (dependencies)"]);
});

test("a peer range and an external package are left alone", () => {
  const manifests = [{ name: "@a/ui", peerDependencies: { "@a/core": "^0.1.0" } }, { name: "@a/core" }];
  assert.deepEqual(checkWorkspaceRanges(manifests), []);
});
