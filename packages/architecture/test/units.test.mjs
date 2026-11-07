import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { baseVersion, buildC4, buildC4FromFiles, globMatches, isOrgPackage, unitsOf } from "../src/index.mjs";

const filesOf = (entries) =>
  new Map(
    Object.entries(entries).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
const unit = (units, path, ecosystem) =>
  units.find((u) => u.path === path && (!ecosystem || u.ecosystem === ecosystem));
const dep = (u, name) => u.dependsOn.find((d) => d.name === name);

const PNPM_LOCK = `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      '@krizaka/config':
        specifier: ^0.17.0
        version: 0.21.0
  apps/web:
    dependencies:
      '@krizaka/ui':
        specifier: ^4.0.0
        version: 4.2.1(react@19.3.1)
      '@demo/core':
        specifier: workspace:*
        version: link:../../packages/core
`;

const pnpmWorkspace = () =>
  filesOf({
    "package.json": { name: "demo", private: true, devDependencies: { "@krizaka/config": "^0.17.0" } },
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'packages/*'\n  - '!packages/skip'\n",
    "pnpm-lock.yaml": PNPM_LOCK,
    "tsconfig.json": "{}",
    "apps/web/package.json": {
      name: "@demo/web",
      private: true,
      dependencies: { next: "16", "@krizaka/ui": "^4.0.0", "@demo/core": "workspace:*", "@krizaka/intl": "~0.3.0" },
    },
    "apps/web/app/page.tsx": 'import { Button } from "@krizaka/ui";\nexport default () => Button;',
    "packages/core/package.json": { name: "@krizaka/demo-core", version: "1.2.0", description: "The core" },
    "packages/skip/package.json": { name: "@krizaka/skip", version: "0.0.1" },
    "packages/broken/package.json": "{ not json",
    "node_modules/@krizaka/ui/package.json": { name: "@krizaka/ui", version: "4.2.1" },
  });

describe("units: npm", () => {
  const units = unitsOf(pnpmWorkspace());

  it("reads the root and the workspace members, never node_modules nor an excluded or broken package", () => {
    assert.deepEqual(
      units.map((u) => `${u.ecosystem}:${u.path}`),
      ["npm:.", "npm:apps/web", "npm:packages/core"],
    );
  });

  it("takes the version that builds the unit from pnpm-lock.yaml, else the range", () => {
    const web = unit(units, "apps/web");
    assert.deepEqual(dep(web, "@krizaka/ui"), {
      ecosystem: "npm",
      name: "@krizaka/ui",
      range: "^4.0.0",
      have: "4.2.1",
      from: "lockfile",
      dev: false,
    });
    assert.equal(dep(web, "@krizaka/intl").have, "0.3.0");
    assert.equal(dep(web, "@krizaka/intl").from, "range");
    assert.equal(
      dep(web, "@demo/core"),
      undefined,
      "a workspace package that is not an org package is not an org dependency",
    );
    assert.equal(dep(unit(units, "."), "@krizaka/config").have, "0.21.0");
    assert.equal(dep(unit(units, "."), "@krizaka/config").dev, true);
  });

  it("says what is published and in which language", () => {
    assert.equal(unit(units, "packages/core").published, true);
    assert.equal(unit(units, "packages/core").version, "1.2.0");
    assert.equal(unit(units, "apps/web").published, false);
    assert.equal(unit(units, "apps/web").language, "typescript");
  });

  it("reads package-lock.json, per workspace and hoisted at the root", () => {
    const npm = unitsOf(
      filesOf({
        "package.json": { name: "site", workspaces: ["apps/*"], dependencies: { "@krizaka/org": "^1.0.0" } },
        "apps/a/package.json": { name: "a", dependencies: { "@krizaka/ui": "^4.0.0", "@krizaka/org": "^1.0.0" } },
        "package-lock.json": {
          lockfileVersion: 3,
          packages: {
            "": { name: "site" },
            "node_modules/@krizaka/org": { version: "1.1.0" },
            "node_modules/@krizaka/ui/node_modules/@krizaka/org": { version: "0.9.0" },
            "apps/a/node_modules/@krizaka/ui": { version: "4.0.3" },
          },
        },
      }),
    );
    assert.equal(dep(unit(npm, "."), "@krizaka/org").have, "1.1.0");
    assert.equal(dep(unit(npm, "apps/a"), "@krizaka/ui").have, "4.0.3");
    assert.equal(dep(unit(npm, "apps/a"), "@krizaka/org").have, "1.1.0", "a hoisted package builds the workspace too");
  });
});

const pom = ({ group = "com.krizaka.demo", id, parent = "", deps = "", managed = "", modules = "", props = "" }) =>
  `<?xml version="1.0"?><project>${parent}<groupId>${group}</groupId><artifactId>${id}</artifactId><version>1.0.0</version>` +
  `<description>The ${id} &amp; more</description>${props}${modules}` +
  `<dependencyManagement><dependencies>${managed}</dependencies></dependencyManagement><dependencies>${deps}</dependencies></project>`;
const dependency = (group, id, version = "", scope = "") =>
  `<dependency><groupId>${group}</groupId><artifactId>${id}</artifactId>${version ? `<version>${version}</version>` : ""}${scope ? `<scope>${scope}</scope>` : ""}</dependency>`;

describe("units: Maven", () => {
  const files = filesOf({
    "pom.xml": pom({
      id: "demo",
      parent:
        "<parent><groupId>com.krizaka</groupId><artifactId>krizaka-parent</artifactId><version>0.12.0</version></parent>",
      props: "<properties><krizaka.version>0.12.0</krizaka.version></properties>",
      modules: "<modules><module>core</module><module>web</module><module>gone</module></modules>",
      managed:
        dependency("com.krizaka", "krizaka-bom", "${krizaka.version}", "import") +
        dependency("org.springframework", "spring-core", "7.0.0"),
    }),
    "core/pom.xml": pom({ id: "core", deps: dependency("com.krizaka", "krizaka-security") }),
    "web/pom.xml": pom({
      id: "web",
      deps: dependency("com.krizaka.demo", "core") + dependency("com.krizaka", "krizaka-test-support", "", "test"),
    }),
    "broken/pom.xml": "<project><artifactId>broken",
  });
  const units = unitsOf(files);

  it("reads the reactor and its modules, a module without a pom left out", () => {
    assert.deepEqual(
      units.map((u) => `${u.path} ${u.name}`),
      [". com.krizaka.demo:demo", "core com.krizaka.demo:core", "web com.krizaka.demo:web"],
    );
    assert.deepEqual(unit(units, ".").modules, ["core", "web", "gone"]);
  });

  it("an imported BOM and the org parent are dependencies, a managed list is not", () => {
    const root = unit(units, ".");
    assert.deepEqual(
      root.dependsOn.map((d) => [d.name, d.have, d.parent ?? false]),
      [
        ["com.krizaka:krizaka-bom", "0.12.0", false],
        ["com.krizaka:krizaka-parent", "0.12.0", true],
      ],
    );
  });

  it("a managed version says so, a test scope is a development dependency", () => {
    const security = dep(unit(units, "core"), "com.krizaka:krizaka-security");
    assert.equal(security.range, "managed");
    assert.equal(security.have, null);
    assert.equal(dep(unit(units, "web"), "com.krizaka:krizaka-test-support").dev, true);
    assert.equal(unit(units, "web").published, true);
  });

  it("a container description is read with the parser (entities decoded)", () => {
    const c4 = buildC4FromFiles(files, { name: "demo" });
    const core = c4.levels.containers.nodes.find((n) => n.id === "container:core");
    assert.equal(core.description, "The core & more");
    assert.equal(core.version, "1.0.0");
    assert.equal(core.ecosystem, "maven");
    assert.ok(c4.levels.containers.edges.some((e) => e.from === "container:web" && e.to === "container:core"));
  });
});

describe("units: Rust and Python", () => {
  const units = unitsOf(
    filesOf({
      "Cargo.toml": '[workspace]\nmembers = ["plugin"]\n',
      "plugin/Cargo.toml":
        '[package]\nname = "tauri-plugin-krizaka"\nversion = "0.4.0"\npublish = false\n\n[dependencies]\nkrizaka-desktop = { git = "https://github.com/krizaka/krizaka-desktop", tag = "v0.3.0" }\nserde = "1"\n',
      "kit/Cargo.toml": '[package]\nname = "krizaka-desktop"\nversion = "0.4.0"\n',
      "bad/Cargo.toml": "[package\nname=",
      "worker/pyproject.toml":
        '[project]\nname = "sovkora-worker"\nversion = "1.0.0"\ndependencies = ["krizaka-common>=0.2", "httpx"]\n',
      "scripts/requirements.txt": "krizaka-tools==0.1.0\nrequests\n# a comment\n",
      "worker/requirements.txt": "ignored-because-pyproject\n",
    }),
  );

  it("reads every crate with a [package], a bare workspace or a broken file left out", () => {
    assert.deepEqual(
      units.filter((u) => u.ecosystem === "cargo").map((u) => [u.path, u.name, u.published]),
      [
        ["kit", "krizaka-desktop", true],
        ["plugin", "tauri-plugin-krizaka", false],
      ],
    );
    const kit = dep(unit(units, "plugin", "cargo"), "krizaka-desktop");
    assert.equal(kit.range, "v0.3.0");
    assert.equal(kit.have, "0.3.0");
  });

  it("reads a pyproject, else a requirements.txt in a folder of its own", () => {
    const worker = unit(units, "worker", "python");
    assert.equal(worker.name, "sovkora-worker");
    assert.deepEqual(
      worker.dependsOn.map((d) => [d.name, d.range]),
      [["krizaka-common", ">=0.2"]],
    );
    const scripts = unit(units, "scripts", "python");
    assert.equal(scripts.name, null);
    assert.deepEqual(
      scripts.dependsOn.map((d) => d.name),
      ["krizaka-tools"],
    );
    assert.equal(units.filter((u) => u.path === "worker").length, 1);
  });
});

describe("helpers", () => {
  it("baseVersion, globMatches, isOrgPackage", () => {
    assert.equal(baseVersion("^0.19.0"), "0.19.0");
    assert.equal(baseVersion("workspace:*"), null);
    assert.equal(baseVersion(null), null);
    assert.ok(globMatches("apps/*", "apps/web") && !globMatches("apps/*", "apps/web/x"));
    assert.ok(globMatches("packages/**", "packages/a/b") && globMatches("deploy/backup", "deploy/backup"));
    assert.ok(isOrgPackage.maven("com.krizaka.sovkora:engine") && !isOrgPackage.maven("com.krizakax:y"));
    assert.ok(isOrgPackage.npm("@krizaka/ui") && !isOrgPackage.npm("@krizakax/ui"));
  });
});

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("a map of files and a checkout give the same view", () => {
  it("buildC4FromFiles on the files equals buildC4 on the same files on disk, and is deterministic", () => {
    const files = pnpmWorkspace();
    const root = mkdtempSync(join(tmpdir(), "c4-files-"));
    dirs.push(root);
    for (const [path, text] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const fromDisk = buildC4(root);
    const fromMap = buildC4FromFiles(files, { name: root.split("/").pop() });
    assert.deepEqual(fromMap, fromDisk);
    assert.equal(JSON.stringify(buildC4FromFiles(files)), JSON.stringify(buildC4FromFiles(files)));
    const web = fromMap.levels.containers.nodes.find((n) => n.id === "container:@demo/web");
    assert.equal(web.dependsOn.find((d) => d.name === "@krizaka/ui").have, "4.2.1");
    assert.equal(web.language, "typescript");
  });

  it("an empty map gives an empty view", () => {
    assert.deepEqual(buildC4FromFiles(new Map()).levels.containers.nodes, []);
    assert.deepEqual(unitsOf(new Map()), []);
  });
});
