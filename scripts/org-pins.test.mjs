// A pin of an org action or workflow must name a commit that has the file: the Release of @krizaka/payments failed at
// "Set up job" because `actions/cdn-purge` was pinned to a commit that predates it (run of 2026-10-30). The test reads
// every `uses: krizaka/.github/...@<sha>` of the workflows and asks GitHub for the file at that sha: a 404 fails.
// A network error is not a pin error and is not reported as one.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../.github/workflows/", import.meta.url);
const pins = new Map();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
  for (const m of readFileSync(new URL(file, dir), "utf8").matchAll(/uses:\s*krizaka\/\.github\/(\S+?)@([0-9a-f]{40})/g)) {
    const path = m[1].endsWith(".yml") ? m[1] : `${m[1]}/action.yml`;
    pins.set(`${path}@${m[2]}`, { path, sha: m[2], file });
  }
}

describe("org pins", () => {
  it("find at least one pin", () => {
    expect(pins.size).toBeGreaterThan(0);
  });

  it.each([...pins.values()])("$file: $path exists at $sha", async ({ path, sha }) => {
    let status = 200;
    try {
      status = (await fetch(`https://raw.githubusercontent.com/krizaka/.github/${sha}/${path}`, { method: "HEAD" })).status;
    } catch {
      return; // offline: nothing to say about the pin
    }
    expect(status, `${path} is missing at ${sha}: pin a commit that has it`).not.toBe(404);
  });
});
