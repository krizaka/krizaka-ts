// Coverage is reported for every package (krizaka/.github#377): a package whose tests run vitest writes the lcov report
// SonarCloud reads, the CI step collects it from the path the workflow names, and turbo caches it with the test result.
import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const packages = readdirSync(new URL("../packages", import.meta.url));

test("every package that tests with vitest writes an lcov report", () => {
  for (const name of packages) {
    const { scripts = {} } = JSON.parse(read(`packages/${name}/package.json`));
    if (!scripts.test?.startsWith("vitest run")) continue;
    expect(scripts.test, `${name}: the test script must run with --coverage`).toMatch(/--coverage\b/);
    expect(scripts.test, `${name}: the reporter must be lcov`).toMatch(/--coverage\.reporter=lcov/);
  }
});

test("the workflow, the Sonar properties and turbo agree on where the reports are", () => {
  expect(read(".github/workflows/ci.yml")).toMatch(/sonar-coverage-paths: packages\/\*\/coverage\/lcov\.info/);
  expect(read("sonar-project.properties")).toMatch(
    /^sonar\.javascript\.lcov\.reportPaths=packages\/\*\/coverage\/lcov\.info$/m,
  );
  expect(JSON.parse(read("turbo.json")).tasks.test.outputs).toEqual(["coverage/**"]);
});

test("the coverage provider is a root dependency pinned with vitest", () => {
  const { devDependencies } = JSON.parse(read("package.json"));
  expect(devDependencies["@vitest/coverage-v8"]).toBeTruthy();
});
