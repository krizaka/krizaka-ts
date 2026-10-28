import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { envNamesOf, localTarget, packageOf, specifiersOf } from "../src/imports.mjs";
import { buildC4, toText } from "../src/index.mjs";
import { asc } from "../src/order.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.mjs");
const dirs = [];

/** A fixture checkout from `{ "path": content }`. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "c4-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const workspace = () => fixture({
  "package.json": { name: "demo", private: true, workspaces: ["apps/*", "packages/*"] },
  "apps/web/package.json": { name: "@demo/web", private: true, dependencies: { next: "16", "@demo/core": "*", "@krizaka/ui": "3" } },
  "apps/web/lib/env.ts": 'export const env = { DATABASE_URL: z.string(), MAIL_PROVIDER: z.string(), APP_URL: z.string(), NODE_ENV: z.string() };',
  "apps/web/lib/db.ts": 'import { sql } from "@demo/core/db";\nimport { helper } from "./util";\nconst url = process.env.DATABASE_URL;\nexport const x = [sql, helper, url];',
  "apps/web/lib/util.ts": "export const helper = 1;",
  "apps/web/app/page.tsx": 'import { x } from "@/lib/db";\nimport { Button } from "@krizaka/ui";\nimport { helper } from "../lib/util";\nexport default () => [x, Button, helper];',
  "apps/web/app/page.test.tsx": 'import "@demo/core";',
  "packages/core/package.json": { name: "@demo/core", description: "The core", dependencies: {} },
  "packages/core/src/db/index.ts": "export const sql = 1;",
  "packages/core/src/index.ts": 'export * from "./db";',
  "packages/core/node_modules/dep/index.js": "module.exports = 1;",
});

describe("containers", () => {
  const c4 = buildC4(workspace());
  const containers = c4.levels.containers;
  const named = (name) => containers.nodes.find((n) => n.name === name);

  it("reads the workspace packages as containers, apps apart from libraries", () => {
    assert.equal(named("@demo/web").kind, "app");
    assert.equal(named("@demo/web").technology, "Next.js");
    assert.equal(named("@demo/core").kind, "library");
    assert.equal(named("@demo/core").description, "The core");
    assert.equal(c4.repo, "demo");
  });

  it("links every node to its files, tests and node_modules left out", () => {
    const web = named("@demo/web");
    assert.ok(web.files.includes("apps/web/package.json") && web.files.includes("apps/web/app/page.tsx"));
    assert.ok(!web.files.some((f) => f.includes(".test.")));
    assert.ok(!named("@demo/core").files.some((f) => f.includes("node_modules")));
  });

  it("draws the dependency between containers from the imports and the manifest", () => {
    const edge = containers.edges.find((e) => e.from === "container:@demo/web" && e.to === "container:@demo/core");
    assert.equal(edge.label, "uses");
    assert.ok(edge.files.includes("apps/web/lib/db.ts") && edge.files.includes("apps/web/package.json"));
  });

  it("reaches the external services from the env declarations and reads, never a vendor", () => {
    const names = containers.nodes.filter((n) => n.level === "external").map((n) => n.name).sort();
    assert.deepEqual(names, ["Database", "Krizaka libraries", "Mail provider"]);
    const db = containers.nodes.find((n) => n.id === "external:database");
    assert.match(db.description, /DATABASE_URL/);
    assert.ok(containers.edges.some((e) => e.from === "container:@demo/web" && e.to === "external:database" && e.label === "reads"));
    assert.ok(!containers.nodes.some((n) => /APP_URL|NODE_ENV/.test(n.description)));
  });
});

describe("context and components", () => {
  const { levels } = buildC4(workspace());

  it("the context is the system and what it reaches", () => {
    assert.deepEqual(levels.context.nodes.map((n) => n.id), ["external:database", "external:krizaka-libraries", "external:mail", "system:demo"]);
    assert.ok(levels.context.edges.every((e) => e.from === "system:demo"));
  });

  it("the components are the folders, with the imports between them", () => {
    const ids = levels.components.nodes.map((n) => n.id);
    assert.ok(ids.includes("component:@demo/web/lib") && ids.includes("component:@demo/web/app") && ids.includes("component:@demo/core/db"));
    const edge = (from, to) => levels.components.edges.find((e) => e.from === from && e.to === to);
    assert.equal(edge("component:@demo/web/app", "component:@demo/web/lib").label, "imports");
    assert.equal(edge("component:@demo/web/lib", "container:@demo/core").label, "uses");
    assert.equal(edge("component:@demo/web/lib", "external:database").label, "reads");
    assert.equal(edge("component:@demo/core/root", "component:@demo/core/db"), undefined);
  });

  it("is deterministic", () => {
    const root = workspace();
    assert.deepEqual(buildC4(root), buildC4(root));
  });
});

describe("other layouts", () => {
  it("a single package is one container", () => {
    const c4 = buildC4(fixture({ "package.json": { name: "solo", dependencies: { next: "16" } }, "app/page.tsx": "export default 1;", "lib/a.ts": 'import "../app/page";' }));
    assert.deepEqual(c4.levels.containers.nodes.map((n) => n.id), ["container:solo"]);
    assert.ok(c4.levels.components.edges.some((e) => e.from === "component:solo/lib" && e.to === "component:solo/app"));
  });

  it("a pnpm-workspace.yaml is read", () => {
    const c4 = buildC4(fixture({ "package.json": { name: "p" }, "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - '!packages/skip'\n", "packages/a/package.json": { name: "a", dependencies: { b: "*" } }, "packages/b/package.json": { name: "b" }, "packages/skip/package.json": { name: "skip" } }));
    assert.deepEqual(c4.levels.containers.nodes.map((n) => n.name), ["a", "b"]);
    assert.equal(c4.levels.containers.edges[0].label, "uses");
  });

  it("Maven modules are containers and depend on their siblings", () => {
    const pom = (id, deps = []) => `<project><parent><artifactId>root</artifactId></parent><artifactId>${id}</artifactId><dependencies>${deps.map((d) => `<dependency><groupId>g</groupId><artifactId>${d}</artifactId></dependency>`).join("")}</dependencies></project>`;
    const c4 = buildC4(fixture({ "pom.xml": "<project><modules><module>core</module><module>web</module></modules></project>", "core/pom.xml": pom("core"), "web/pom.xml": pom("web", ["core", "jackson"]) }));
    assert.deepEqual(c4.levels.containers.nodes.map((n) => n.technology), ["Maven", "Maven"]);
    assert.deepEqual(c4.levels.containers.edges.map((e) => [e.from, e.to]), [["container:web", "container:core"]]);
  });

  it("an empty folder gives an empty view, not a crash", () => {
    const c4 = buildC4(fixture({ "README.md": "x" }));
    assert.deepEqual(c4.levels.containers.nodes, []);
  });
});

describe("order", () => {
  it("asc is code-point order, the one Array#sort uses by default", () => {
    const words = ["b", "B", "a", "é", "_"];
    assert.deepEqual([...words].sort(asc), [...words].sort());
    assert.equal(asc("a", "a"), 0);
  });
});

describe("helpers", () => {
  it("packageOf, localTarget, specifiersOf, envNamesOf", () => {
    assert.equal(packageOf("@a/b/c"), "@a/b");
    assert.equal(packageOf("react/jsx"), "react");
    assert.equal(packageOf("./x"), undefined);
    assert.equal(packageOf("node:fs"), undefined);
    assert.equal(localTarget("../x", "a/b/c.ts", "a"), "a/x");
    assert.equal(localTarget("@/lib/x", "a/b/c.ts", "a"), "a/lib/x");
    assert.deepEqual(specifiersOf('import a from "x";\nimport {\n b } from \'y\';\nconst c = require("z");\nimport("w");\nimport "v";'), ["x", "y", "z", "w", "v"]);
    assert.deepEqual(envNamesOf("MAIL_PROVIDER NEXT_PUBLIC_APP_URL foo", { declaration: true }), ["APP_URL", "MAIL_PROVIDER"]);
    assert.deepEqual(envNamesOf("process.env.AUTH_SECRET_KEY + process.env.HOME", { declaration: false }), ["AUTH_SECRET_KEY"]);
  });
});

describe("text version and CLI", () => {
  it("the text lists every node and relation by name", () => {
    const text = toText(buildC4(workspace()));
    assert.match(text, /## Containers/);
    assert.match(text, /- @demo\/web \(app, Next\.js\)/);
    assert.match(text, /@demo\/web uses @demo\/core/);
    assert.match(text, /@demo\/web reads Database/);
  });

  it("writes the JSON to --out and one level with --level", () => {
    const root = workspace();
    const out = join(root, "..", `c4-${Date.now()}.json`);
    dirs.push(out);
    execFileSync("node", [cli, root, "--out", out, "--text", `${out}.md`]);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).schema, "krizaka.c4/1");
    assert.match(readFileSync(`${out}.md`, "utf8"), /C4 from the code/);
    const level = JSON.parse(execFileSync("node", [cli, root, "--level", "containers"], { encoding: "utf8" }));
    assert.equal(level.level, "containers");
    assert.ok(Array.isArray(level.nodes) && Array.isArray(level.edges));
    dirs.push(`${out}.md`);
  });

  it("refuses a missing path and an unknown level", () => {
    assert.throws(() => execFileSync("node", [cli, "/nope/nowhere"], { stdio: "pipe" }), /status 2|Command failed/);
    assert.throws(() => execFileSync("node", [cli, workspace(), "--level", "x"], { stdio: "pipe" }), /Command failed/);
  });
});
