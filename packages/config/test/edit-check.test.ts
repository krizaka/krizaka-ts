import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkFile,
  classify,
  editedFile,
  findUp,
  matchesDigest,
  PMD,
  pmdArguments,
} from "../edit-check/edit-check.js";

/** A project folder holding a fake ESLint that ends with the given shell body. */
function projectWithEslint(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "edit-check-"));
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  const eslint = join(root, "node_modules/.bin/eslint");
  writeFileSync(eslint, `#!/bin/sh\n${body}\n`);
  chmodSync(eslint, 0o755);
  writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
  return root;
}

describe("which tool checks a file", () => {
  it("sends TypeScript and JavaScript to ESLint and Java to PMD", () => {
    expect(classify("src/a.tsx")).toBe("eslint");
    expect(classify("lib/b.mjs")).toBe("eslint");
    expect(classify("src/main/java/com/krizaka/A.java")).toBe("pmd");
  });

  it("leaves tests, generated folders and other languages alone", () => {
    expect(classify("src/test/java/com/krizaka/ATest.java")).toBeNull();
    expect(classify("node_modules/x/index.js")).toBeNull();
    expect(classify("target/classes/A.java")).toBeNull();
    expect(classify("README.md")).toBeNull();
  });
});

describe("the edited file", () => {
  it("is the argument when there is one", () => {
    expect(editedFile("a.ts", "")).toBe("a.ts");
  });

  it("is read from the JSON a Claude Code hook writes", () => {
    expect(editedFile(undefined, JSON.stringify({ tool_input: { file_path: "/r/a.ts" } }))).toBe("/r/a.ts");
  });

  it("is null for an empty or broken input", () => {
    expect(editedFile(undefined, "")).toBeNull();
    expect(editedFile(undefined, "{nope")).toBeNull();
    expect(editedFile(undefined, "{}")).toBeNull();
  });
});

describe("ESLint on one file", () => {
  it("returns the findings with exit 2", () => {
    const root = projectWithEslint('echo "a.ts:1:1: no-var" >&2; exit 1');
    const result = checkFile(join(root, "a.ts"));
    expect(result.code).toBe(2);
    expect(result.message).toContain("no-var");
  });

  it("is silent when the file is clean", () => {
    const root = projectWithEslint("exit 0");
    expect(checkFile(join(root, "a.ts"))).toEqual({ code: 0, message: "" });
  });

  it("is silent when ESLint cannot run (exit 2)", () => {
    const root = projectWithEslint('echo "config error" >&2; exit 2');
    expect(checkFile(join(root, "a.ts")).code).toBe(0);
  });

  it("is silent on a timeout", () => {
    const root = projectWithEslint("sleep 5; exit 1");
    expect(checkFile(join(root, "a.ts"), { budgetMs: 200 })).toEqual({ code: 0, message: "" });
  });

  it("is silent without an ESLint in the project", () => {
    const root = mkdtempSync(join(tmpdir(), "edit-check-none-"));
    writeFileSync(join(root, "a.ts"), "");
    expect(findUp(join(root, "a.ts"), "node_modules/.bin/eslint")).toBeNull();
    expect(checkFile(join(root, "a.ts")).code).toBe(0);
  });
});

describe("PMD on one file", () => {
  it("never runs Maven and checks the one file with the given rules", () => {
    const args = pmdArguments("rules.xml", "/r/A.java");
    expect(args).toEqual(expect.arrayContaining(["check", "-R", "rules.xml", "-d", "/r/A.java"]));
    expect(args.join(" ")).not.toMatch(/mvn|maven/);
  });

  it("is silent while the pinned PMD is not cached yet", () => {
    const cache = mkdtempSync(join(tmpdir(), "edit-check-cache-"));
    const file = join(cache, "A.java");
    writeFileSync(file, "class A {}");
    expect(checkFile(file, { cache })).toEqual({ code: 0, message: "" });
  });

  it("returns the findings of the cached PMD with exit 2", () => {
    const cache = mkdtempSync(join(tmpdir(), "edit-check-cache-"));
    const bin = join(cache, `pmd-bin-${PMD.version}`, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "pmd"), '#!/bin/sh\necho "/x/A.java:3:\\tCognitiveComplexity"\n');
    chmodSync(join(bin, "pmd"), 0o755);
    writeFileSync(join(cache, "pmd-ruleset.xml"), "<ruleset/>");
    const file = join(cache, "A.java");
    writeFileSync(file, "class A {}");
    const result = checkFile(file, { cache });
    expect(result.code).toBe(2);
    expect(result.message).toContain("CognitiveComplexity");
  });
});

describe("the pinned download", () => {
  it("accepts only the archive of the pinned digest", () => {
    expect(PMD.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(matchesDigest(Buffer.from("not pmd"), PMD.digest)).toBe(false);
  });
});
