import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "../prettier.config.js";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const TSC = require.resolve("typescript/bin/tsc");

describe("prettier", () => {
  it("is the Krizaka style: 120 columns, double quotes, trailing commas", () => {
    expect(prettier).toMatchObject({ printWidth: 120, singleQuote: false, trailingComma: "all" });
  });
});

describe("tsconfig bases", () => {
  it.each(["base", "react-library", "next", "react-native"])("%s resolves to a strict config", (name) => {
    const base = fileURLToPath(new URL(`../tsconfig/${name}.json`, import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "krizaka-tsconfig-"));
    try {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: base, include: ["index.ts"] }));
      const shown = JSON.parse(execFileSync(process.execPath, [TSC, "--showConfig", "-p", dir], { encoding: "utf8" }));
      expect(shown.compilerOptions).toMatchObject({ strict: true, moduleResolution: "bundler", isolatedModules: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("react bases set JSX", () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(`../tsconfig/${name}.json`, import.meta.url), "utf8"));
    expect(read("react-library").compilerOptions.jsx).toBe("react-jsx");
    expect(read("next").compilerOptions.plugins).toEqual([{ name: "next" }]);
    expect(read("react-native").compilerOptions.customConditions).toEqual(["react-native"]);
  });
});

describe("package surface", () => {
  it("exports every config file and the ratchet bin", () => {
    expect(Object.keys(pkg.exports)).toEqual(
      expect.arrayContaining([
        "./eslint",
        "./eslint/next",
        "./eslint/krizaka-ui",
        "./eslint/no-locale-ternary",
        "./eslint/stack",
        "./eslint/plugin",
        "./dependency-cruiser",
        "./covered-domains",
        "./known-violations",
        "./server-client-boundary",
        "./prettier",
        "./tsconfig/base.json",
        "./tsconfig/react-library.json",
        "./tsconfig/next.json",
        "./tsconfig/react-native.json",
      ]),
    );
    expect(pkg.bin).toEqual({
      "krizaka-ratchet": "./bin/krizaka-ratchet.mjs",
      "krizaka-known-violations": "./bin/krizaka-known-violations.mjs",
      "krizaka-server-client-boundary": "./bin/krizaka-server-client-boundary.mjs",
      "krizaka-sg-ratchet": "./bin/krizaka-sg-ratchet.mjs",
      "krizaka-seo-family": "./bin/krizaka-seo-family.mjs",
    });
    expect(pkg.peerDependencies).toMatchObject({ eslint: "^9 || ^10", typescript: "^5" });
  });

  it("carries no product word", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const shipped = [
      ...["bin", "eslint", "ratchet", "tsconfig"].flatMap((dir) => readdirSync(join(root, dir)).map((f) => `${dir}/${f}`)),
      "patterns.js",
      "dependency-cruiser.cjs",
      "prettier.config.js",
      ".editorconfig",
    ];
    expect(shipped.length).toBeGreaterThan(10);
    for (const file of shipped) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).not.toMatch(/orochia|orazaka/i);
    }
  });
});

describe("README", () => {
  it("lists every domain of the covered-domains map, its rule and every refused entry (the table is the map's)", async () => {
    const { readFileSync } = await import("node:fs");
    const { coveredDomains, ruleName } = await import("../covered-domains.cjs");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const domain of coveredDomains) {
      expect(readme, domain.id).toContain(`\`${ruleName(domain)}\``);
      expect(readme, domain.id).toContain(`\`${domain.home}\``);
      for (const entry of domain.refused) expect(readme, `${domain.id}: ${entry}`).toContain(`\`${entry}\``);
    }
  });
});

// @krizaka/config 0.9.0 was published from a stale copy in krizaka-ui without these: the pre-push hooks of the apps broke
// (« krizaka-known-violations: not found »). krizaka-ts is the single source; the package must ship its whole surface.
describe("published surface", () => {
  const files = new Set<string>(pkg.files);
  const exportsMap = Object.keys(pkg.exports);

  it.each(["krizaka-ratchet", "krizaka-known-violations"])("the bin %s exists and is shipped", (name) => {
    const target = pkg.bin[name] as string;
    expect(target).toBeTruthy();
    expect(readdirSync(fileURLToPath(new URL("../bin", import.meta.url)))).toContain(target.replace("./bin/", ""));
    expect(files.has("bin")).toBe(true);
  });

  it.each(["./covered-domains", "./covered-domains.json", "./dependency-cruiser", "./known-violations", "./eslint/stack"])(
    "exports %s",
    (entry) => {
      expect(exportsMap).toContain(entry);
    },
  );

  it("every export and bin points to a file that exists and is published", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const targets = [...Object.values(pkg.exports), ...Object.values(pkg.bin)] as string[];
    for (const target of targets) {
      expect(() => readFileSync(join(root, target))).not.toThrow();
      expect(target === "./package.json" || files.has(target.slice(2)) || [...files].some((f) => target.startsWith(`./${f}/`))).toBe(true);
    }
  });

  it("knows the two effect rules and their ratchet counters", async () => {
    const { STACK_RULES } = await import("../eslint/stack.js");
    expect(STACK_RULES).toEqual(expect.arrayContaining(["krizaka/no-async-in-effect", "krizaka/no-derived-state-in-effect"]));
    const { STACK_COUNTERS } = await import("../ratchet/ratchet.js");
    expect(STACK_COUNTERS).toEqual(expect.arrayContaining(["asyncInEffect", "derivedStateInEffect"]));
  });
});
