import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import { compare, countStream, ruleDirsFromConfig, ruleIdsFromDir } from "../bin/krizaka-sg-ratchet.mjs";

describe("sg-ratchet", () => {
  it("counts the violations per rule from the JSON stream", () => {
    const stream = ['{"ruleId":"a"}', '{"ruleId":"b"}', "", '{"ruleId":"a"}', "not json"].join("\n");
    assert.deepEqual(countStream(stream), { a: 2, b: 1 });
  });

  it("fails when a count goes up", () => {
    const r = compare({ a: 2, b: 0 }, { a: 3 }, ["a", "b"]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.increased, ["a"]);
  });

  it("passes and lowers when a count goes down, never raises", () => {
    const r = compare({ a: 5 }, { a: 2 }, ["a"]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.decreased, ["a"]);
    assert.deepEqual(r.next, { a: 2 });
  });

  it("refuses a rule that is not recorded yet", () => {
    const r = compare({ a: 1 }, { a: 1, c: 4 }, ["a", "c"]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.unrecorded, ["c"]);
    assert.equal(r.next.c, 4);
  });
});

describe("sg-ratchet — rule directories", () => {
  it("reads the ruleDirs of sgconfig.yml, the pack's sets and the repository's own rules", () => {
    const root = mkdtempSync(join(tmpdir(), "sg-"));
    mkdirSync(join(root, "rules"));
    writeFileSync(join(root, "rules", "local.yml"), "id: local-rule\nlanguage: Tsx\n");
    writeFileSync(
      join(root, "sgconfig.yml"),
      "# c\nruleDirs:\n  - ./node_modules/@krizaka/config/ast-grep/core\n  - rules\ntestConfigs:\n  - testDir: rule-tests\n",
    );
    assert.deepEqual(ruleDirsFromConfig(root), [
      join(root, "node_modules/@krizaka/config/ast-grep/core"),
      join(root, "rules"),
    ]);
    assert.deepEqual(ruleIdsFromDir(root), ["local-rule"]);
    rmSync(root, { recursive: true });
  });

  it("the pack's sets carry every rule once, each with a test", () => {
    const here = new URL("../ast-grep/", import.meta.url).pathname;
    const all = ["core", "web", "html"].flatMap((set) => {
      const dir = join(here, set);
      return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8").match(/^id:\s*(\S+)/m)?.[1]);
    });
    assert.equal(new Set(all).size, all.length);
  });
});
