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
        "./prettier",
        "./tsconfig/base.json",
        "./tsconfig/react-library.json",
        "./tsconfig/next.json",
        "./tsconfig/react-native.json",
      ]),
    );
    expect(pkg.bin).toEqual({ "krizaka-ratchet": "./bin/krizaka-ratchet.mjs" });
    expect(pkg.peerDependencies).toMatchObject({ eslint: "^9", typescript: "^5" });
  });

  it("carries no product word", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const shipped = [
      ...["bin", "eslint", "ratchet", "tsconfig"].flatMap((dir) => readdirSync(join(root, dir)).map((f) => `${dir}/${f}`)),
      "patterns.js",
      "prettier.config.js",
      ".editorconfig",
    ];
    expect(shipped.length).toBeGreaterThan(10);
    for (const file of shipped) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).not.toMatch(/orochia|orazaka/i);
    }
  });
});
