import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8"));

/** Packages whose `check` script rebuilds their own dist (rm + tsup) — the Release gate runs them in one turbo graph. */
function packagesThatRebuildInCheck() {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(root, "packages", entry.name, "package.json"), "utf8")))
    .filter((pkg) => /\bbuild\b/.test(pkg.scripts?.check ?? ""))
    .map((pkg) => pkg.name);
}

describe("turbo task graph", () => {
  it("packages whose check rebuilds their dist wait for their dependencies' check", () => {
    // Regression: release run 40039950746 failed with « Failed to resolve entry for package "@krizaka/db" » — @krizaka/db's
    // check rebuilt its dist (rm + tsup) while @krizaka/audit's tests, which depend only on its build, were reading it.
    expect(packagesThatRebuildInCheck()).toContain("@krizaka/db");
    expect(turbo.tasks.check.dependsOn).toContain("^check");
  });
});
