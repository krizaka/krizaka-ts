import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import { BEGIN, componentNames, END, render } from "../scripts/ui-names.mjs";

const RULE = new URL("../ast-grep/web/no-local-ui-copy.yml", import.meta.url);

function fakeUi(registry: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "ui-"));
  mkdirSync(join(dir, "registry"));
  const exports: Record<string, string> = { ".": "./dist/index.js", "./cn": "./dist/cn.js" };
  for (const name of Object.keys(registry)) exports[`./${name}`] = `./dist/${name}.js`;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ exports }));
  for (const [name, item] of Object.entries(registry))
    writeFileSync(join(dir, "registry", `${name}.json`), JSON.stringify(item));
  return dir;
}

describe("ui-names — the names @krizaka/ui exports", () => {
  it("takes the components of each entry and the entry's own name, never a constant or a member", () => {
    const dir = fakeUi({
      tabs: { web: { props: [{ component: "TabsRoot" }, { component: "TabsList" }] } },
      "data-table": { web: { props: [{ component: "DataTable" }, { component: "SiteFooter.Column" }] } },
      page: { web: { props: [{ component: "PAPER_GRAIN_ID" }] } },
      native: { web: undefined },
    });
    assert.deepEqual(componentNames(dir), ["DataTable", "TabsList", "TabsRoot", "Tabs"].sort());
    rmSync(dir, { recursive: true });
  });

  it("rewrites only the generated block", () => {
    const source = `a: 1\n    ${BEGIN}\n    regex: ^(Old)$\n    ${END}\nb: 2\n`;
    const out = render(source, ["Button", "Tabs"]);
    assert.ok(out.startsWith("a: 1\n") && out.endsWith(`${END}\nb: 2\n`));
    assert.ok(out.includes("regex: ^(Button|Tabs)$"));
    assert.throws(() => render("no markers", ["A"]));
  });

  it("the committed rule lists what the installed @krizaka/ui exports (run `pnpm run gen:ui-names`)", () => {
    const committed = readFileSync(RULE, "utf8");
    assert.equal(render(committed, componentNames()), committed);
  });
});
