import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import { BEGIN, END, exportedNames, facadeDomains, render } from "../scripts/package-exports.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/package-exports.mjs", import.meta.url));

function fakeRepo(packages: Record<string, { json?: Record<string, unknown>; files: Record<string, string> }>): string {
  const root = mkdtempSync(join(tmpdir(), "pkgs-"));
  for (const [id, pkg] of Object.entries(packages)) {
    const dir = join(root, id);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: `@krizaka/${id}`, exports: { ".": { import: "./dist/index.js" } }, ...pkg.json }),
    );
    for (const [file, text] of Object.entries(pkg.files)) {
      mkdirSync(dirname(join(dir, "src", file)), { recursive: true });
      writeFileSync(join(dir, "src", file), text);
    }
  }
  return root;
}

describe("package-exports — what the packages give an app", () => {
  it("lists the distinctive exported names, follows `export *`, never a generic one or a private one", () => {
    const root = fakeRepo({
      outbox: {
        files: {
          "index.ts": [
            'export * from "./relay.js";',
            "export function createOutbox() {}",
            "export const OUTBOX_LIMIT = 3;",
            "export interface Query {}",
            "export type OutboxEntry = string;",
            "export class OutboxError extends Error {}",
            "function privateHelper() {}",
            "export { hiddenName as publicName };",
            "const hiddenName = 1;",
          ].join("\n"),
          "relay.ts": "export const relayEvents = () => 1;",
        },
      },
    });
    assert.deepEqual(exportedNames(root), ["createOutbox", "OutboxEntry", "OutboxError", "publicName", "relayEvents"]);
  });

  it("reads the entries of `exports` only (a source nobody exports is not a name an app can import)", () => {
    const root = fakeRepo({
      audit: {
        json: { exports: { ".": { import: "./dist/index.js" }, "./package.json": "./package.json" } },
        files: { "index.ts": "export const recordAudit = 1;", "internal.ts": "export const internalOnlyName = 1;" },
      },
    });
    assert.deepEqual(exportedNames(root), ["recordAudit"]);
  });

  it("builds a facade domain from `krizaka.facade`, sorted, and refuses a half declaration", () => {
    const facade = { title: "Storage", wraps: ["opendal", "arctic"], use: "`@krizaka/storage`" };
    const root = fakeRepo({
      storage: { json: { krizaka: { facade } }, files: { "index.ts": "" } },
      time: { files: { "index.ts": "" } },
    });
    assert.deepEqual(facadeDomains(root), [
      {
        id: "storage",
        title: "Storage",
        home: "@krizaka/storage",
        use: "`@krizaka/storage`",
        refused: ["arctic", "opendal"],
      },
    ]);
    const bad = fakeRepo({ storage: { json: { krizaka: { facade: { wraps: [] } } }, files: { "index.ts": "" } } });
    assert.throws(() => facadeDomains(bad), /needs `wraps`/);
  });

  it("replaces only the generated block of a rule", () => {
    const source = `a: 1\n    ${BEGIN}\n    regex: ^(old)$\n    ${END}\nb: 2\n`;
    const next = render(source, ["createOutbox", "OutboxError"]);
    assert.ok(next.startsWith("a: 1\n") && next.endsWith("\nb: 2\n"));
    assert.ok(next.includes("regex: ^(createOutbox|OutboxError)$"));
    assert.throws(() => render("no markers", []), /generated markers are missing/);
  });

  it("the committed rule and facades.json are what the packages give (`--check`)", () => {
    const run = spawnSync("node", [SCRIPT, "--check"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  });
});
