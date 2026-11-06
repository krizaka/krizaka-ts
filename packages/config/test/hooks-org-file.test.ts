import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import { readOrgFile } from "../hooks/org-file.js";

const dir = () => mkdtempSync(join(tmpdir(), "kz-orgfile-"));
const answer =
  (body: string, ok = true) =>
  async () => ({ ok, text: async () => body });

describe("hooks org file", () => {
  it("fetches, caches and returns the text", async () => {
    const cache = dir();
    assert.equal(await readOrgFile("a.json", { cache, fetcher: answer("{}") }), "{}");
    assert.equal(readFileSync(join(cache, "a.json"), "utf8"), "{}");
  });

  it("uses a fresh cache without going to the network", async () => {
    const cache = dir();
    writeFileSync(join(cache, "a.json"), "cached");
    const fetcher = async () => {
      throw new Error("network used");
    };
    assert.equal(await readOrgFile("a.json", { cache, fetcher }), "cached");
  });

  it("falls back to a stale cache when offline, and to null when there is none", async () => {
    const cache = dir();
    const offline = async () => {
      throw new Error("offline");
    };
    assert.equal(await readOrgFile("a.json", { cache, fetcher: offline }), null);
    writeFileSync(join(cache, "a.json"), "old");
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(join(cache, "a.json"), old, old);
    assert.equal(await readOrgFile("a.json", { cache, fetcher: offline }), "old");
    assert.equal(await readOrgFile("a.json", { cache, fetcher: answer("x", false) }), "old");
  });
});
