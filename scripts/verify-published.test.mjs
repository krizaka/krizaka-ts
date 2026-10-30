import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePublished, waitForPackages } from "./verify-published.mjs";

const pkgs = parsePublished(
  '[{"name":"@krizaka/storage","version":"0.3.1"},{"name":"@krizaka/settings","version":"0.5.0"}]',
);
const noSleep = { sleep: async () => {} };

describe("verify-published", () => {
  it("parses the action output, empty when nothing published", () => {
    expect(pkgs).toHaveLength(2);
    expect(parsePublished("")).toEqual([]);
  });
  it("returns nothing missing once every package is visible, after some retries", async () => {
    let calls = 0;
    const visible = async () => ++calls > 3;
    expect(await waitForPackages(pkgs, visible, noSleep)).toEqual([]);
  });
  it("names the packages still missing when the retries run out", async () => {
    const visible = async (name) => name !== "@krizaka/storage";
    expect(await waitForPackages(pkgs, visible, noSleep)).toEqual([{ name: "@krizaka/storage", version: "0.3.1" }]);
  });
});

describe("release.yml guard", () => {
  it("verifies on npm what the changesets step published", () => {
    const yml = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(yml).toMatch(/scripts\/verify-published\.mjs/);
    expect(yml).toMatch(/steps\.changesets\.outputs\.publishedPackages/);
  });
});
