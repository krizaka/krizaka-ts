// krizaka-restricted#316: this repo's ADRs moved to krizaka-internal. The public
// repo hosts none of its own ADR files and links to none by its old local path.
// Guard for the move (krizaka-ts#366): red on main (the files and relative links
// are still there), green once they are gone. An absolute URL to another repo's
// ADR (krizaka/.github, krizaka/krizaka-ui) is untouched and not what this checks.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const self = fileURLToPath(import.meta.url);
const SKIP = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".next",
]);
const TEXT = /\.(md|mdx|ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$/;
const ADR_FILE = /\/docs\/adr\/ADR-[^/]+\.md$/;
const LOCAL_ADR = /[^\s()"'`]*docs\/adr\/ADR-[A-Za-z0-9.-]+\.md/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        walk(new URL(`${entry.name}/`, dir), out);
      }
    } else if (entry.isFile()) {
      out.push(new URL(entry.name, dir));
    }
  }
  return out;
}

const files = walk(root);

describe("the repository's ADRs live in krizaka-internal", () => {
  it("hosts no ADR file of its own", () => {
    const adrs = [];
    for (const url of files) {
      const path = fileURLToPath(url);
      if (ADR_FILE.test(path)) {
        adrs.push(path);
      }
    }
    expect(adrs).toEqual([]);
  });

  it("links to no moved ADR by its old local path", () => {
    const offenders = [];
    for (const url of files) {
      const path = fileURLToPath(url);
      if (path === self || !TEXT.test(path)) {
        continue;
      }
      for (const match of readFileSync(url, "utf8").matchAll(LOCAL_ADR)) {
        if (!match[0].includes("://")) {
          offenders.push(`${path}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
