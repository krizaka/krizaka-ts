// The GitHub runners moved to Ubuntu 26.04, which Playwright supports from 1.61.0 ("Playwright does not support chromium
// on ubuntu26.04-x64", krizaka-internal#4129). A workflow that installs an older Playwright fails on every run.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FIRST_UBUNTU_2604 = [1, 61, 0];
const dir = new URL("../.github/workflows/", import.meta.url);
const atLeast = (version, floor) => {
  const parts = version.split(".").map(Number);
  return floor.reduce((ok, n, i) => (ok === null ? (parts[i] === n ? null : parts[i] > n) : ok), null) ?? true;
};

describe("workflows that install Playwright", () => {
  const pins = readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .flatMap((f) =>
      [...readFileSync(new URL(f, dir), "utf8").matchAll(/playwright(?:-core)?@(\d+\.\d+\.\d+)/g)].map((m) => ({ file: f, version: m[1] })),
    );

  it("pin a release that supports Ubuntu 26.04 (1.61.0 or later)", () => {
    const tooOld = pins.filter((p) => !atLeast(p.version, FIRST_UBUNTU_2604));
    expect(tooOld).toEqual([]);
  });
  it("is looking at the site workflow", () => {
    expect(pins.some((p) => p.file === "site.yml")).toBe(true);
  });
});
