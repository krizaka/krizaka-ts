import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { absolutizeLinks, changelogBody, exportsOf, installTabs, mdxSafe, orderFromReadme, renderPage, sourceOfExport, withoutTitle } from "../scripts/packages-lib.mjs";

const messages = (hook = "One line.") => ({
  packages: { demo: { hook } },
  docs: {
    packages: "Packages",
    install: { title: "Install", subpaths: "Also: {paths}." },
    readmeNote: "Note",
    exports: { title: "Exports", lead: "{count} names.", name: "Name", kind: "Kind", summary: "What" },
    kinds: { function: "function", class: "class", const: "constant", type: "type", enum: "enum" },
    facts: { title: "Package", version: "Version", unpublished: "Not on npm", license: "Licence", node: "Node", dependencies: "Deps", peers: "Peers", none: "none", source: "Source" },
    changelog: { title: "Changelog" },
  },
});
const pkg = { id: "demo", name: "@krizaka/demo", version: "1.2.3", license: "Apache-2.0", node: ">=22", dependencies: { "date-fns": "^4" }, peerDependencies: {}, exports: [{ name: "makeIt", kind: "function", summary: "Makes | it." }], subpaths: [], readme: "# @krizaka/demo\n\nHello {world} <b>.\n\n```ts\nconst a = { b: 1 } < 2;\n```\n", changelog: "# @krizaka/demo\n\n## 1.2.3\n\n### Minor Changes\n\n- abc1234: First <release>.\n" };

test("MDX-unsafe characters are escaped in prose and left alone in code", () => {
  const out = mdxSafe("a {b} <c> `{d}` <https://x.y>\n```\n{e} <f>\n```");
  assert.match(out, /a \\\{b\\\} &lt;c> `\{d\}` <https:\/\/x\.y>/);
  assert.match(out, /\{e\} <f>/);
});

test("relative links become GitHub links, absolute ones stay", () => {
  const out = absolutizeLinks("[a](./src/x.ts) [b](https://z.io) [c](#top)", "auth");
  assert.match(out, /\(https:\/\/github\.com\/krizaka\/krizaka-ts\/blob\/main\/packages\/auth\/src\/x\.ts\)/);
  assert.match(out, /\(https:\/\/z\.io\)/);
  assert.match(out, /\(#top\)/);
});

test("the README's own title is dropped", () => assert.equal(withoutTitle("# T\n\nbody"), "body"));

test("the changelog loses commit hashes and keeps a heading per version", () => {
  const out = changelogBody(pkg.changelog);
  assert.match(out, /^### 1\.2\.3/);
  assert.match(out, /\*\*Minor changes\*\*|\*\*Minor Changes\*\*/i);
  assert.doesNotMatch(out, /abc1234/);
  assert.match(out, /&lt;release>/);
});

test("exports are read from the types: kind and first sentence", () => {
  const dir = mkdtempSync(join(tmpdir(), "kz-ts-"));
  writeFileSync(join(dir, "port.ts"), "/** A port. More text. */\nexport interface Port { a: 1 }\nexport class Boom extends Error {}\n");
  writeFileSync(join(dir, "index.ts"), "export * from \"./port\";\n/** Builds it. */\nexport function build(): number { return 1; }\nexport const LIMIT = 3;\nexport const make = (a: number) => a;\nexport { type Port as Alias } from \"./port\";\n");
  const found = Object.fromEntries(exportsOf(join(dir, "index.ts")).map((e) => [e.name, e]));
  assert.equal(found.build.kind, "function");
  assert.equal(found.build.summary, "Builds it.");
  assert.equal(found.LIMIT.kind, "const");
  assert.equal(found.make.kind, "function");
  assert.equal(found.Port.kind, "type");
  assert.equal(found.Port.summary, "A port.");
  assert.equal(found.Boom.kind, "class");
  assert.ok(found.Alias);
});

test("subpath exports map to their source file", () => {
  assert.equal(sourceOfExport({ types: "./dist/testkit.d.ts", import: "./dist/testkit.js" }), "src/testkit.ts");
  assert.equal(sourceOfExport("./dist/index.js"), "src/index.ts");
});

test("a page has the install command, the README, the exports, the version token and the changelog, in each language", () => {
  for (const locale of ["en", "fr"]) {
    const page = renderPage(pkg, locale, messages());
    assert.match(page, /^---\ntitle: "@krizaka\/demo"\ndescription: "One line\."\n---/);
    assert.ok(page.includes(installTabs("@krizaka/demo")));
    assert.match(page, /Hello \\\{world\\\} &lt;b>/);
    assert.match(page, /\| `makeIt` \| function \| Makes \\\| it\. \|/);
    assert.match(page, /%@krizaka\/demo%/);
    assert.match(page, /## Changelog/);
    assert.equal(page.includes("> Note"), locale === "fr");
  }
});

test("an unpublished package states no version", () => {
  const page = renderPage({ ...pkg, version: null }, "en", messages());
  assert.doesNotMatch(page, /%@krizaka\/demo%/);
  assert.match(page, /Not on npm/);
});

test("a package without its one-line message fails the page", () => {
  assert.throws(() => renderPage(pkg, "en", { ...messages(), packages: {} }), /packages\.demo\.hook/);
});

test("the repository README is the catalogue: it gives the order, and a missing package fails", () => {
  const readme = "| [`a`](packages/a#readme) |\n| [`b`](packages/b#readme) |";
  assert.deepEqual(orderFromReadme(readme, ["b", "a"]), ["a", "b"]);
  assert.throws(() => orderFromReadme(readme, ["a", "b", "c"]), /does not list c/);
});
