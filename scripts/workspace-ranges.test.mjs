import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

const root = new URL("../packages/", import.meta.url);
const manifests = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => JSON.parse(readFileSync(new URL(`${e.name}/package.json`, root), "utf8")));
const own = new Set(manifests.map((m) => m.name));

describe("a package of this repository is depended on through workspace:, never a registry range", () => {
  // A registry range goes stale when the dependency is versioned (`^0.1.0` vs 0.4.0): `changeset version` then fails and no
  // Version Packages pull request is ever opened (the Release run of 2026-10-29).
  it("every dependency naming a workspace package uses workspace:", () => {
    const bad = [];
    for (const m of manifests) {
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const [name, range] of Object.entries(m[field] ?? {})) {
          if (own.has(name) && field !== "peerDependencies" && !String(range).startsWith("workspace:")) bad.push(`${m.name} -> ${name}@${range} (${field})`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
});
