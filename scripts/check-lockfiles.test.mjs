import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it } from "vitest";

import { checkLockfile, LOCKED_FOLDERS } from "./check-lockfiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** An npm project whose package.json asks `asked` for `dep` while its lockfile records `locked`. */
function npmProject(asked, locked) {
  const dir = mkdtempSync(join(tmpdir(), "lockfiles-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { dep: asked } }),
  );
  const lock = {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "fixture", version: "1.0.0", dependencies: { dep: locked } },
      "node_modules/dep": {
        version: locked.replace(/^\^/, ""),
        resolved: "https://registry.npmjs.org/dep/-/dep-1.0.0.tgz",
        integrity: "sha512-AAAA",
      },
    },
  };
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
  return dir;
}

describe("a package.json changed without its lockfile is refused", () => {
  it("refuses a package.json that asks for more than its lockfile records", () => {
    const result = checkLockfile(npmProject("^1.2.0", "^1.0.0"));
    assert.equal(result?.ok, false);
    assert.match(result?.output ?? "", /in sync|does not satisfy|Invalid/);
  });

  it("accepts a package.json its lockfile records", () => {
    assert.equal(checkLockfile(npmProject("^1.0.0", "^1.0.0"))?.ok, true);
  });

  it("ignores a folder without a lockfile", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockfiles-"));
    dirs.push(dir);
    assert.equal(checkLockfile(dir), null);
  });
});

describe("the current tree", () => {
  for (const folder of LOCKED_FOLDERS) {
    it(`${folder} lockfile matches its package.json`, () => {
      const result = checkLockfile(join(root, folder));
      assert.equal(result?.ok, true, result?.output);
    });
  }
});
