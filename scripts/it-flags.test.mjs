import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

// An integration test switched on by a flag (`process.env.<NAME>_IT`) that turbo does not pass through is silently skipped in CI:
// turbo's strict env mode hides it (it happened to STORAGE_S3_IT, #235). Every flag a test reads must be in `passThroughEnv`.
const root = new URL("../", import.meta.url);
const turbo = JSON.parse(readFileSync(new URL("turbo.json", root), "utf8"));
const passed = new Set(Object.values(turbo.tasks ?? {}).flatMap((task) => task.passThroughEnv ?? []));

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return testFiles(url);
    return /\.test\.(ts|mts|mjs)$/.test(entry.name) ? [url] : [];
  });
}

describe("integration test flags", () => {
  it("every *_IT flag a package test reads is passed through by turbo", () => {
    const flags = new Set();
    for (const file of testFiles(new URL("packages/", root))) for (const match of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z0-9_]+_IT)\b/g)) flags.add(match[1]);
    assert.ok(flags.size > 0);
    assert.deepEqual([...flags].filter((flag) => !passed.has(flag)), []);
  });
});
