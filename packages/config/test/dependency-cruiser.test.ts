import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SHARED = fileURLToPath(new URL("../dependency-cruiser.cjs", import.meta.url));
const DEPCRUISE = fileURLToPath(new URL("../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", import.meta.url));
const shared = require(SHARED) as { forbidden: { name: string }[] };

let root: string;
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const pkg = (name: string, main: string) => {
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0", main: "index.js" }));
  write(`node_modules/${name}/index.js`, main);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "krizaka-depcruise-"));
  pkg("@tanstack/react-query", "exports.useQuery = () => null;\n");
  // the facade imports TanStack: allowed
  pkg("@krizaka/query", `const { useQuery } = require("@tanstack/react-query");\nexports.useQuery = useQuery;\n`);
  write("app/ok.js", `const { useQuery } = require("@krizaka/query");\nmodule.exports = useQuery;\n`);
  write(".dependency-cruiser.cjs", `module.exports = { extends: ${JSON.stringify(SHARED)}, forbidden: [] };\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// `err` (the default reporter) sets the exit code; `json` lists the violations
const cruise = (output = "json") =>
  spawnSync(process.execPath, [DEPCRUISE, "app", "--config", ".dependency-cruiser.cjs", "--output-type", output], {
    cwd: root,
    encoding: "utf8",
  });

describe("@krizaka/config/dependency-cruiser", () => {
  it("is one rule: no @tanstack/* from an app", () => {
    expect(shared.forbidden.map((rule) => rule.name)).toEqual(["krizaka-no-direct-tanstack"]);
  });

  it("lets an app use a @krizaka facade that imports TanStack", () => {
    expect(cruise("err").status).toBe(0);
    const run = cruise();
    expect(JSON.parse(run.stdout).summary.violations).toEqual([]);
  });

  it("refuses an app importing @tanstack/* directly, declared or not", () => {
    write("app/direct.js", `module.exports = require("@tanstack/react-query");\n`);
    write("app/undeclared.js", `module.exports = require("@tanstack/react-table");\n`);
    expect(cruise("err").status).toBe(2);
    const run = cruise();
    const violations = JSON.parse(run.stdout).summary.violations as { from: string; rule: { name: string } }[];
    expect(violations.map((v) => [v.from, v.rule.name]).sort()).toEqual([
      ["app/direct.js", "krizaka-no-direct-tanstack"],
      ["app/undeclared.js", "krizaka-no-direct-tanstack"],
    ]);
  });
});
