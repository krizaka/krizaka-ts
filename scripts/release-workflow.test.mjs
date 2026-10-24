// The Release workflow checks the packages before it publishes. `turbo run check` runs every package's own `check` script,
// which ends with a build that deletes `dist/`: a package under test lost the dist of the workspace package it imports
// ("Failed to resolve entry for package @krizaka/db", run 40039950746). The gate builds first, then runs the same lint,
// typecheck and test as CI.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// the commands only: comments may name what they forbid
const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

describe("release.yml", () => {
  it("does not run the packages' own `check` scripts in parallel (their builds delete dist under the others' tests)", () => {
    expect(release).not.toMatch(/turbo run check/);
  });
  it("builds the workspace first, then runs the CI checks", () => {
    expect(release).toMatch(/pnpm run build\s*&&\s*pnpm run check/);
  });
});

describe("release.yml version step", () => {
  it("updates the lockfile with the version bump, so the next frozen install passes", () => {
    expect(release).toMatch(/version-script:\s*pnpm changeset version\s*&&\s*pnpm install --lockfile-only/);
  });
});
