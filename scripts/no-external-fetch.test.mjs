// The unit suite makes no request to a third party (krizaka-internal#3669): the org URL liveness test fetched every URL of the org
// JSON and a 502 or a slow network failed every push. A network check belongs to a scheduled watch (`org-urls.yml`), never to
// `packages/*/test`. This guard refuses a `fetch(` whose target is written as a non-local http(s) URL in a package's tests.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/;
const CALL = /\bfetch\(\s*[`'"]https?:\/\/([^/:`'"?#\s]+)/g;

/** The non-local hosts a source `fetch`es with a literal URL, `${…}` hosts (a variable: unknowable) aside. */
export function externalFetches(source) {
  return [...source.matchAll(CALL)].map((m) => m[1]).filter((host) => !host.startsWith("$") && !LOCAL.test(host));
}

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : testFiles(path);
    return /\.(test\.)?[cm]?[jt]sx?$/.test(e.name) ? [path] : [];
  });
}

describe("externalFetches (the guard's own fixtures)", () => {
  it("finds a fetch of a third party's URL", () => {
    expect(externalFetches('await fetch("https://github.com/krizaka", { method: "HEAD" })')).toEqual(["github.com"]);
    expect(externalFetches("fetch(`https://cdn.example.com/${id}`)")).toEqual(["cdn.example.com"]);
  });
  it("lets a local server through", () => {
    expect(externalFetches('fetch("http://localhost:3000/x"); fetch(`http://127.0.0.1:9000/${n}`)')).toEqual([]);
  });
  it("ignores a variable target and a mere mention", () => {
    expect(externalFetches("fetch(url); fetch(`${endpoint}/a`); refetch('https://a.com')")).toEqual([]);
  });
});

describe("no package test requests a third party", () => {
  const tests = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      try {
        return testFiles(join(root, "packages", e.name, "test"));
      } catch {
        return [];
      }
    });

  it("has test files to look at", () => {
    expect(tests.length).toBeGreaterThan(20);
  });

  it("calls fetch only on a local host", () => {
    const hits = tests.flatMap((file) =>
      externalFetches(readFileSync(file, "utf8")).map((host) => `${file.slice(root.length + 1)}: fetch to ${host}`),
    );
    expect(hits).toEqual([]);
  });
});
