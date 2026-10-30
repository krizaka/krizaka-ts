import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BRAND, CDN, ICONS, get } from "../scripts/sync-brand-icons.mjs";

// Anti-drift guard: every committed icon is the CDN file listed in brand/manifest.json.
test("committed icons match the brand manifest on the CDN", async () => {
  const manifest = JSON.parse((await get(`${CDN}/brand/manifest.json`)).toString());
  for (const [name, dest] of Object.entries(ICONS)) {
    const entry = manifest.files.find((f) => f.path === `brand/${BRAND}/${name}`);
    assert.ok(entry, `${name} is in the manifest`);
    const sha = createHash("sha256")
      .update(await readFile(resolve(import.meta.dirname, "..", dest)))
      .digest("hex");
    assert.equal(
      sha,
      entry.sha256,
      `${dest} drifted from brand/${BRAND}/${name}; run node scripts/sync-brand-icons.mjs`,
    );
  }
});
