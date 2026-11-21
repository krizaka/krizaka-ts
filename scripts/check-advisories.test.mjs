import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cmp, floors, resolved, violations } from "./check-advisories.mjs";

const lockWith = (...entries) =>
  `lockfileVersion: '9.0'\n\npackages:\n\n${entries.map((e) => `  ${e}\n    resolution: {integrity: sha512-x}`).join("\n\n")}\n`;

describe("check-advisories", () => {
  it("compares numeric major.minor.patch versions", () => {
    expect(cmp("10.5.0", "9.0.0")).toBeGreaterThan(0);
    expect(cmp("8.1.0", "9.0.0")).toBeLessThan(0);
    expect(cmp("14.0.2", "14.0.2")).toBe(0);
    expect(cmp("0.28.2", "0.28.1")).toBeGreaterThan(0);
    expect(cmp("0.27.7", "0.28.1")).toBeLessThan(0);
  });

  it("parses only top-level packages: entries and strips peer suffixes", () => {
    const lock = [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "  .:",
      "    dependencies:",
      "      glob:",
      "        version: 10.5.0",
      "",
      "packages:",
      "",
      "  glob@14.0.2:",
      "    resolution: {integrity: sha512-a}",
      "",
      "  '@scope/x@1.0.0:'",
      "    resolution: {integrity: sha512-b}",
      "",
      "  '@scope/y@2.3.4(react@18.2.0)':",
      "    resolution: {integrity: sha512-c}",
      "",
      "  esbuild@0.28.2(peer@1.0.0):",
      "    resolution: {integrity: sha512-d}",
      "",
      "snapshots:",
      "",
      "  glob@10.5.0: {}",
      "  esbuild@0.27.7: {}",
      "",
    ].join("\n");

    expect(resolved(lock)).toEqual([
      { name: "glob", version: "14.0.2" },
      { name: "@scope/x", version: "1.0.0" },
      { name: "@scope/y", version: "2.3.4" },
      { name: "esbuild", version: "0.28.2" },
    ]);
    expect(violations(lock)).toEqual([]);
  });

  it("passes when resolved versions meet the floors", () => {
    const lock = lockWith("glob@14.0.2:", "esbuild@0.28.1:", "'@scope/x@1.0.0':");
    expect(floors).toEqual({
      glob: { min: "14.0.2", from: "9.0.0" },
      esbuild: { min: "0.28.1" },
    });
    expect(violations(lock)).toEqual([]);
  });

  it("flags glob 10.5.0", () => {
    expect(violations(lockWith("glob@10.5.0:"))).toEqual(["glob@10.5.0 (needs >= 14.0.2)"]);
  });

  it("ignores glob 8.1.0 below the v9 floor range", () => {
    expect(violations(lockWith("glob@8.1.0:"))).toEqual([]);
  });

  it("flags esbuild 0.27.7", () => {
    expect(violations(lockWith("esbuild@0.27.7:"))).toEqual(["esbuild@0.27.7 (needs >= 0.28.1)"]);
  });

  it("allows esbuild 0.28.2", () => {
    expect(violations(lockWith("esbuild@0.28.2:"))).toEqual([]);
  });

  it("strips peer suffixes before checking floors", () => {
    const lock = lockWith("glob@10.5.0(foo@1.0.0):", "'esbuild@0.27.7(@types/node@20.0.0)':");
    expect(violations(lock)).toEqual(["glob@10.5.0 (needs >= 14.0.2)", "esbuild@0.27.7 (needs >= 0.28.1)"]);
  });

  it("reports no violations for the repo pnpm-lock.yaml", () => {
    const lockPath = join(fileURLToPath(new URL(".", import.meta.url)), "..", "pnpm-lock.yaml");
    const lockText = readFileSync(lockPath, "utf8");
    expect(resolved(lockText).length).toBeGreaterThan(0);
    expect(violations(lockText)).toEqual([]);
  });
});
