// The Release workflow checks the packages before it publishes. `turbo run check` runs every package's own `check` script,
// which ends with a build that deletes `dist/`: a package under test lost the dist of the workspace package it imports
// ("Failed to resolve entry for package @krizaka/db", run 40039950746). The gate builds first, then runs the same lint,
// typecheck and test as CI.
import { readdirSync, readFileSync } from "node:fs";
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
    // the action runs version-script without a shell: one npm script, never `&&` in the workflow
    expect(release).toMatch(/version-script:\s*pnpm run version-packages\b/);
    expect(release).not.toMatch(/version-script:[^\n]*&&/);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["version-packages"]).toBe("changeset version && pnpm install --lockfile-only");
  });
});

// A job without `timeout-minutes` runs for six hours when a step hangs; the org's workflow test (zizmor/pins) and the
// Scorecard job both ask for a bound. Every job of our own runner workflows carries one.
describe("workflows", () => {
  it("every job that runs on a runner has timeout-minutes (a hung step never holds a runner for six hours)", () => {
    const dir = new URL("../.github/workflows/", import.meta.url);
    const missing = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      const text = readFileSync(new URL(file, dir), "utf8");
      const jobs = text.split(/^jobs:\s*$/m)[1] ?? "";
      for (const block of jobs.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1)) {
        if (/^\s+runs-on:/m.test(block) && !/^\s+timeout-minutes:/m.test(block)) {
          missing.push(`${file}: ${block.split(":")[0]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
