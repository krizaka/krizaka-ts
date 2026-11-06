import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { findCodeNames } from "../src";

/** The repository's root and its tracked files (git is the list: nothing ignored, nothing built). */
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);

/** The historic table and the tests that prove the guard on it; history (CHANGELOG.md) is skipped like the bin does. */
const HISTORIC = new Set([
  "packages/org/src/brands.ts",
  "packages/org/test/brands.test.ts",
  "packages/org/test/no-code-names.test.ts",
]);

describe("krizaka-ts holds no retired code name (founder, 2026-11-06, krizaka-internal#2659)", () => {
  it("outside the historic table and the history", () => {
    const hits: string[] = [];
    for (const file of tracked) {
      if (HISTORIC.has(file) || basename(file) === "CHANGELOG.md") continue;
      const buf = readFileSync(join(root, file));
      if (buf.subarray(0, 8192).includes(0)) continue;
      for (const hit of findCodeNames(file + "\n" + buf.toString("utf8")))
        hits.push(`${file}: ${hit.word} → ${hit.use}`);
    }
    expect(hits).toEqual([]);
  });
});
