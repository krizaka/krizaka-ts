import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const release = readFileSync(join(__dirname, "../../../.github/workflows/release.yml"), "utf8");

describe("the release workflow", () => {
  it("purges org/v1/org.json on the CDN right after publishing it", () => {
    const publish = release.indexOf("run: pnpm run build && pnpm run publish:cdn");
    const purge = release.indexOf("krizaka/.github/actions/cdn-purge@");
    expect(publish).toBeGreaterThan(0);
    expect(purge).toBeGreaterThan(publish);
    expect(release).toContain("org/v1/org.json");
    expect(release).toContain("secrets.MEDIA_ACCOUNT_API_KEY");
  });
});
