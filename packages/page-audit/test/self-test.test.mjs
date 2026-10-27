import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { selfTest } from "../src/index.mjs";

// Needs a Chromium (`npx playwright-core install chromium`); skipped where there is none, run in CI of the apps.
const hasBrowser = await import("playwright-core").then(async (m) => { try { return !!(await m.chromium.launch().then((b) => b.close().then(() => true))); } catch { return false; } }, () => false);

describe("the audit on its own fixtures", () => {
  it.skipIf(!hasBrowser)("sees the broken layouts (card over the next section, overlap, cut column) and none of the fine ones", async () => {
    assert.deepEqual(await selfTest(), []);
  });
});
