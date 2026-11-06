import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { HOOKS, readSteps } from "../hooks/declaration.js";

describe("hooks declaration", () => {
  it("a repository without declaration gets the built-in steps and its precheck script on push", () => {
    const steps = readSteps({ scripts: { precheck: "pnpm run check" } });
    assert.deepEqual(steps["pre-commit"], [{ name: "secrets", builtin: "secrets" }]);
    assert.deepEqual(steps["commit-msg"], [{ name: "trailers", builtin: "trailers" }]);
    assert.deepEqual(steps["pre-push"], [{ name: "precheck", script: "precheck" }]);
  });

  it("a repository with no declaration and no precheck pushes with no step", () => {
    assert.deepEqual(readSteps({})["pre-push"], []);
    assert.deepEqual(readSteps(undefined)["pre-push"], []);
  });

  it("declared steps replace the precheck default and follow the built-in ones", () => {
    const steps = readSteps({
      scripts: { precheck: "x" },
      krizaka: {
        hooks: {
          "pre-push": [{ name: "check", run: "pnpm run check" }],
          "pre-commit": [{ name: "lint", run: "pnpm lint-staged" }],
        },
      },
    });
    assert.deepEqual(steps["pre-push"], [{ name: "check", run: "pnpm run check" }]);
    assert.deepEqual(steps["pre-commit"], [
      { name: "secrets", builtin: "secrets" },
      { name: "lint", run: "pnpm lint-staged" },
    ]);
  });

  it("an unknown hook, a step without name or run, or a duplicate name is refused with a message", () => {
    assert.throws(() => readSteps({ krizaka: { hooks: { "post-merge": [] } } }), /unknown hook "post-merge"/);
    assert.throws(() => readSteps({ krizaka: { hooks: { "pre-push": [{ run: "x" }] } } }), /pre-push\[0\].*name/);
    assert.throws(() => readSteps({ krizaka: { hooks: { "pre-push": [{ name: "a" }] } } }), /pre-push\[0\].*run/);
    assert.throws(
      () =>
        readSteps({
          krizaka: {
            hooks: {
              "pre-push": [
                { name: "a", run: "x" },
                { name: "a", run: "y" },
              ],
            },
          },
        }),
      /duplicate/,
    );
  });

  it("lists the three hooks of the chain", () => {
    assert.deepEqual([...HOOKS], ["pre-commit", "commit-msg", "pre-push"]);
  });
});
