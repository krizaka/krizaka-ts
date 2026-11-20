import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const published = readdirSync(new URL("packages/", root), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(new URL(`packages/${e.name}/package.json`, root)))
  .map((e) => e.name)
  .filter((dir) => !JSON.parse(read(`packages/${dir}/package.json`)).private);

describe("every published package is in the catalogue the site is built from", () => {
  // The site build (site.yml) is not in the CI gate: @krizaka/documents (#499) landed without its README line and its site
  // hook, and main's Site build stayed red. This test runs in `ci / Verify (test)`, inside the gate.
  it("the repository README's table lists it", () => {
    const readme = read("README.md");
    assert.deepEqual(
      published.filter((dir) => !readme.includes(`](packages/${dir}#readme)`)),
      [],
    );
  });

  it.each(["en", "fr"])("site/messages/%s.json has its packages.<dir>.hook", (locale) => {
    const messages = JSON.parse(read(`site/messages/${locale}.json`));
    assert.deepEqual(
      published.filter((dir) => typeof messages.packages?.[dir]?.hook !== "string"),
      [],
    );
  });
});
