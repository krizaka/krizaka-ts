import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isTechnologyName, technologyNamedFiles } from "./check-file-names.mjs";

describe("files are named by what they do", () => {
  it("refuses a technology as a word of the name, not as a part of a word", () => {
    for (const bad of ["postgres.ts", "pg-store.ts", "pg-store.integration.test.ts", "mailgun.ts", "redis-cache.ts", "stripe_webhook.ts"]) expect(isTechnologyName(bad), bad).toBe(true);
    for (const good of ["accounts.ts", "persistence.ts", "db.ts", "pagination.ts", "store.ts", "mail.ts", "page.tsx", "registry.ts"]) expect(isTechnologyName(good), good).toBe(false);
  });

  it("finds them anywhere under packages/, skipping node_modules and dist", () => {
    const root = mkdtempSync(join(tmpdir(), "names-"));
    mkdirSync(join(root, "packages", "a", "src"), { recursive: true });
    mkdirSync(join(root, "packages", "a", "node_modules", "x"), { recursive: true });
    writeFileSync(join(root, "packages", "a", "src", "postgres.ts"), "");
    writeFileSync(join(root, "packages", "a", "src", "accounts.ts"), "");
    writeFileSync(join(root, "packages", "a", "node_modules", "x", "pg.js"), "");
    expect(technologyNamedFiles(root)).toEqual([join("packages", "a", "src", "postgres.ts")]);
  });

  it("holds for this repository", () => {
    expect(technologyNamedFiles(join(__dirname, ".."))).toEqual([]);
  });
});
