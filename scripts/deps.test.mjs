import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { PACKAGES, packagesWithSources } from "./deps.mjs";

describe("dependency-cruiser covers every package (krizaka-ts#77)", () => {
  it("lists every package that owns a src folder: a new one cannot escape the cruise", () => {
    assert.deepEqual(Object.keys(PACKAGES).sort(), packagesWithSources().sort());
  });

  it("each package records its known violations beside it (they only shrink)", () => {
    for (const workspace of Object.keys(PACKAGES)) {
      assert.ok(
        existsSync(new URL(`../${workspace}/.dependency-cruiser-known-violations.json`, import.meta.url)),
        workspace,
      );
    }
  });

  it("the lint script runs it, so CI refuses a new violation", () => {
    const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
    assert.match(scripts.lint, /node scripts\/deps\.mjs/);
    assert.equal(scripts["lint:deps"], "node scripts/deps.mjs");
  });

  it("refuses an import of what renders (ADR-004: krizaka-ui may depend on krizaka-ts, never the reverse)", async () => {
    const { createRequire } = await import("node:module");
    const config = createRequire(import.meta.url)("../.dependency-cruiser.cjs");
    const rule = config.forbidden.find((r) => r.name === "krizaka-ts-not-from-ui");
    assert.ok(rule && rule.severity === "error");
    const pattern = new RegExp(rule.to.path);
    for (const bad of [
      "node_modules/@krizaka/ui/dist/index.js",
      "node_modules/.pnpm/@krizaka+ui@1/node_modules/@krizaka/tokens/index.js",
      "@krizaka/icons",
      "@krizaka/ui/button",
    ])
      assert.match(bad, pattern, bad);
    for (const ok of ["node_modules/@krizaka/db/dist/index.js", "@krizaka/intl", "@krizaka/i18n", "src/ui-kit.ts"])
      assert.doesNotMatch(ok, pattern, ok);
  });
});
