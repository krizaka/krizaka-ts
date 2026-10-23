import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkContent, repositoryPackages } from "../scripts/check-content.mjs";

const SITE = new URL("..", import.meta.url).pathname;

test("every package of the repository has its pages, its meta entry and its one line, in both languages (after `npm run gen`)", () => {
  assert.ok(repositoryPackages().length >= 6);
  assert.deepEqual(checkContent(), []);
});

test("a package without a page fails the check", () => {
  const dir = mkdtempSync(join(tmpdir(), "kz-content-"));
  mkdirSync(dir, { recursive: true });
  for (const f of ["start.mdx", "start.fr.mdx"]) writeFileSync(join(dir, f), "---\ntitle: T\ndescription: D\n---\n\ntext\n");
  for (const f of ["meta.json", "meta.fr.json"]) writeFileSync(join(dir, f), JSON.stringify({ pages: ["start"] }));
  const errors = checkContent({ dir, ids: ["ghost"], messages: join(SITE, "messages") });
  assert.ok(errors.some((e) => /ghost\.mdx: missing/.test(e)));
  assert.ok(errors.some((e) => /does not list ghost/.test(e)));
  assert.ok(errors.some((e) => /packages\.ghost\.hook/.test(e)));
});
