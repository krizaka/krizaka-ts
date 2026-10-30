import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DIR = join(__dirname);
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const tests = readdirSync(DIR).filter((name) => name.endsWith(".test.ts") && name !== "timeouts.test.ts");

// A test that reloads modules (`vi.resetModules()`) pays for the whole import graph again: fast warm, slow on a loaded CI runner, where
// it hit the 5 s default (krizaka-ts#229). Such a test says its budget out loud; the default is not stretched for the rest.
describe("the tests that reload modules say their time budget", () => {
  it("every test file that calls vi.resetModules() passes COLD_IMPORT_TIMEOUT_MS to its test", () => {
    const reloading = tests.filter((name) => read(name).includes("vi.resetModules()"));
    expect(reloading.length).toBeGreaterThan(0);
    // The layout (Prettier puts the budget on its own line) is not what is checked: whitespace is collapsed.
    for (const name of reloading)
      expect(read(name).replace(/\s+/g, " "), name).toMatch(/\}, COLD_IMPORT_TIMEOUT_MS,? ?\)/);
  });
});
