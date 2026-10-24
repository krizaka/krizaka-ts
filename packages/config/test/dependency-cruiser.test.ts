import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { coveredDomains, domainMessage, MISSING_FUNCTION, refusedPattern, ruleName } from "../covered-domains.cjs";
import { runKnownViolations } from "../ratchet/known-violations.js";

const require = createRequire(import.meta.url);
const SHARED = fileURLToPath(new URL("../dependency-cruiser.cjs", import.meta.url));
const DEPCRUISE = fileURLToPath(new URL("../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", import.meta.url));
const shared = require(SHARED) as { forbidden: { name: string }[]; withOptions: (o: { exemptFrom: string[] }) => unknown };

/** The Krizaka facade of a domain: a package that wraps the library. */
const facadeOf = (home: string) => home;
/** A package an app may import to reach a refused entry: `date-fns*` → `date-fns-tz`, `@tanstack/*` → `@tanstack/react-query`. */
const sampleOf = (entry: string) => (entry.endsWith("/*") ? `${entry.slice(0, -1)}sample` : entry.endsWith("*") ? `${entry.slice(0, -1)}-sample` : entry);

let root: string;
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const pkg = (name: string, main: string, extra: Record<string, unknown> = {}) => {
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0", main: "index.js", ...extra }));
  write(`node_modules/${name}/index.js`, main);
};
const config = (extra = "") => write(".dependency-cruiser.cjs", `module.exports = { extends: ${JSON.stringify(SHARED)}, forbidden: [] };\n${extra}`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "krizaka-depcruise-"));
  write("package.json", JSON.stringify({ name: "fixture-app", version: "1.0.0", dependencies: {} }));
  config();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// `err-long` (with the comment of the rule) sets the exit code; `json` lists the violations
const cruise = (output = "json", targets = ["app"], configFile = ".dependency-cruiser.cjs", extra: string[] = []) =>
  spawnSync(process.execPath, [DEPCRUISE, ...targets, "--config", configFile, "--output-type", output, ...extra], { cwd: root, encoding: "utf8" });
const violationsOf = (run = cruise()) =>
  (JSON.parse(run.stdout).summary.violations as { from: string; to: string; rule: { name: string } }[]).map((v) => [v.from, v.rule.name, v.to]);

describe("the covered-domains map", () => {
  it("names, for every domain, a Krizaka home and what is refused", () => {
    expect(coveredDomains.map((d) => d.id)).toEqual(["dates", "i18n", "query", "icons", "ui"]);
    for (const domain of coveredDomains) {
      expect(domain.home).toMatch(/^@krizaka\//);
      expect(domain.use).toContain(domain.home);
      expect(domain.refused.length).toBeGreaterThan(0);
      expect(domain.refused.some((entry) => entry.startsWith("@krizaka/"))).toBe(false);
    }
    const refused = coveredDomains.flatMap((d) => d.refused);
    expect(refused).toEqual(
      expect.arrayContaining(["date-fns*", "dayjs", "luxon", "moment", "@tanstack/*", "lucide-react", "react-icons", "@heroicons/*", "@radix-ui/*"]),
    );
    expect(new Set(refused).size).toBe(refused.length); // one entry, one home
  });

  it("says the Krizaka home and « missing function? add it to the package first »", () => {
    const dates = coveredDomains.find((d) => d.id === "dates")!;
    expect(domainMessage(dates)).toContain("@krizaka/intl");
    expect(domainMessage(dates)).toContain("@krizaka/time");
    expect(MISSING_FUNCTION).toBe("Missing function? add it to the package first.");
    for (const domain of coveredDomains) expect(domainMessage(domain)).toContain(`${domain.home}`);
    for (const domain of coveredDomains) expect(domainMessage(domain)).toMatch(/Missing function\? add it to the package first\.$/);
  });

  it("matches a package, its subpaths, a prefix and a scope — never a local folder of the same name", () => {
    const test = (entry: string, path: string) => new RegExp(refusedPattern(entry)).test(path);
    expect(test("dayjs", "node_modules/dayjs/index.js")).toBe(true);
    expect(test("dayjs", "dayjs/plugin/utc")).toBe(true);
    expect(test("dayjs", "node_modules/.pnpm/dayjs@1.0.0/node_modules/dayjs/esm/index.js")).toBe(true);
    expect(test("dayjs", "app/dayjs/index.ts")).toBe(false);
    expect(test("dayjs", "node_modules/dayjs-like/index.js")).toBe(false);
    expect(test("date-fns*", "node_modules/date-fns-tz/index.js")).toBe(true);
    expect(test("@tanstack/*", "node_modules/@tanstack/react-query/build/index.js")).toBe(true);
    expect(test("@tanstack/*", "@tanstack/react-query")).toBe(true);
  });
});

describe("@krizaka/config/dependency-cruiser", () => {
  it("is one krizaka-first rule per domain of the map, then cycles, unresolvable imports and dev dependencies", () => {
    expect(shared.forbidden.map((rule) => rule.name)).toEqual([
      ...coveredDomains.map((d) => ruleName(d)),
      "no-circular",
      "not-to-unresolvable",
      "not-to-dev-dep",
    ]);
    expect(Object.keys(shared)).toEqual(["forbidden", "options"]); // dependency-cruiser validates the keys
  });

  for (const domain of coveredDomains) {
    describe(`krizaka-first-${domain.id}`, () => {
      const home = facadeOf(domain.home);
      const refusedSamples = domain.refused.map(sampleOf);
      beforeEach(() => {
        // the facade wraps every refused library: its own import is allowed
        for (const sample of refusedSamples) pkg(sample, "exports.x = 1;\n");
        pkg(home, refusedSamples.map((sample) => `require(${JSON.stringify(sample)});`).join("\n") + "\nexports.x = 1;\n");
        write("app/ok.js", `module.exports = require(${JSON.stringify(home)});\n`);
      });

      it("lets an app use the Krizaka home, whose own import of the library is allowed", () => {
        expect(cruise("err").status).toBe(0);
        expect(violationsOf()).toEqual([]);
      });

      it("refuses an app importing each refused library directly, and the message names the Krizaka home", () => {
        refusedSamples.forEach((sample, i) => write(`app/direct-${i}.js`, `module.exports = require(${JSON.stringify(sample)});\n`));
        const run = cruise("err-long");
        expect(run.status).toBe(refusedSamples.length);
        expect(violationsOf().map(([from, rule]) => [from, rule]).sort()).toEqual(
          refusedSamples.map((_, i) => [`app/direct-${i}.js`, ruleName(domain)]).sort(),
        );
        const text = run.stdout.replace(/\s+/g, " ");
        expect(text).toContain(domain.home);
        expect(text).toContain("Missing function? add it to the package first.");
      });

      it("refuses it even when the app does not declare the library (a transitive package, unresolved)", () => {
        write("app/ghost.js", `module.exports = require(${JSON.stringify(sampleOf(domain.refused[0]!).replace(/$/, "/ghost"))});\n`);
        expect(violationsOf().map(([, rule]) => rule)).toContain(ruleName(domain));
      });
    });
  }

  it("exempts the Krizaka packages of a monorepo, by option: the facade wraps the library", () => {
    pkg("@tanstack/react-query", "exports.useQuery = () => null;\n");
    write("packages/query/src/index.js", `module.exports = require("@tanstack/react-query");\n`);
    write("apps/web/page.js", `module.exports = require("@tanstack/react-query");\n`);
    const targets = ["packages", "apps"];
    expect(violationsOf(cruise("json", targets)).map(([from]) => from).sort()).toEqual(["apps/web/page.js", "packages/query/src/index.js"]);
    write(
      ".dependency-cruiser.mono.cjs",
      `module.exports = require(${JSON.stringify(SHARED)}).withOptions({ exemptFrom: ["(^|/)packages/"] });\n`,
    );
    const run = cruise("json", targets, ".dependency-cruiser.mono.cjs");
    expect(violationsOf(run).map(([from]) => from)).toEqual(["apps/web/page.js"]);
  });

  it("fails on a cycle, on an unresolvable import and on a dev dependency in production code", () => {
    write("app/a.js", `module.exports = require("./b");\n`);
    write("app/b.js", `module.exports = require("./a");\n`);
    write("app/missing.js", `module.exports = require("./nowhere");\n`);
    pkg("left-pad", "exports.x = 1;\n");
    write("package.json", JSON.stringify({ name: "fixture-app", version: "1.0.0", devDependencies: { "left-pad": "1.0.0" } }));
    write("app/dev.js", `module.exports = require("left-pad");\n`);
    write("app/dev.test.js", `module.exports = require("left-pad");\n`);
    expect(cruise("err").status).toBeGreaterThan(0);
    const found = violationsOf();
    const rules = (name: string) => found.filter(([, rule]) => rule === name).map(([from]) => from).sort();
    expect(rules("no-circular")).toHaveLength(1); // the cycle, once
    expect(["app/a.js", "app/b.js"]).toContain(rules("no-circular")[0]);
    expect(rules("not-to-unresolvable")).toEqual(["app/missing.js"]);
    expect(rules("not-to-dev-dep")).toEqual(["app/dev.js"]);
  });

  it("is quiet on a clean app", () => {
    write("app/a.js", `module.exports = require("./b");\n`);
    write("app/b.js", `module.exports = 1;\n`);
    expect(cruise("err").status).toBe(0);
  });
});

describe("the known violations only shrink", () => {
  const known = () => JSON.parse(readFileSync(join(root, ".dependency-cruiser-known-violations.json"), "utf8")) as { from: string }[];
  const run = (command: "check" | "update" | "init") => runKnownViolations(command, { cwd: root, targets: ["app"] });
  beforeEach(() => {
    pkg("dayjs", "exports.x = 1;\n");
    pkg("lucide-react", "exports.x = 1;\n");
    write("app/old-date.js", `module.exports = require("dayjs");\n`);
    write("app/old-icon.js", `module.exports = require("lucide-react");\n`);
  });

  it("init records what is broken once; depcruise --ignore-known then passes; init never overwrites", () => {
    expect(cruise("err").status).toBe(2);
    expect(run("init").code).toBe(0);
    expect(known().map((v) => v.from).sort()).toEqual(["app/old-date.js", "app/old-icon.js"]);
    expect(cruise("err", ["app"], ".dependency-cruiser.cjs", ["--ignore-known", ".dependency-cruiser-known-violations.json"]).status).toBe(0);
    expect(run("check").code).toBe(0);
    expect(run("init").code).toBe(1);
  });

  it("refuses a new violation, and update never records it", () => {
    run("init");
    write("app/new.js", `module.exports = require("dayjs");\n`);
    expect(cruise("err", ["app"], ".dependency-cruiser.cjs", ["--ignore-known", ".dependency-cruiser-known-violations.json"]).status).toBe(1); // the new one only
    const checked = run("check");
    expect(checked.code).toBe(1);
    expect(checked.lines.join("\n")).toContain("new: krizaka-first-dates: app/new.js");
    expect(run("update").code).toBe(1);
    expect(known().map((v) => v.from).sort()).toEqual(["app/old-date.js", "app/old-icon.js"]);
  });

  it("a fixed violation must leave the file: check fails until update lowers it", () => {
    run("init");
    writeFileSync(join(root, "app/old-icon.js"), "module.exports = 1;\n");
    const checked = run("check");
    expect(checked.code).toBe(1);
    expect(checked.lines.join("\n")).toContain("fixed but still recorded");
    expect(run("update").code).toBe(0);
    expect(known().map((v) => v.from)).toEqual(["app/old-date.js"]);
    expect(run("check").code).toBe(0);
  });

  it("records a cycle, and tells one cycle from another", () => {
    rmSync(join(root, "app/old-date.js"));
    rmSync(join(root, "app/old-icon.js"));
    write("app/a.js", `module.exports = require("./b");\n`);
    write("app/b.js", `module.exports = require("./a");\n`);
    expect(run("init").code).toBe(0);
    expect(run("check").code).toBe(0);
    write("app/c.js", `module.exports = require("./d");\n`);
    write("app/d.js", `module.exports = require("./c");\n`);
    expect(run("check").code).toBe(1);
  });
});
