import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain .mjs script, no types
import { config, plan, publish } from "../scripts/publish.mjs";

const KEY = "test-key-that-must-never-be-printed";

function makeDist(files: string[]): string {
  const dist = mkdtempSync(join(tmpdir(), "org-dist-"));
  mkdirSync(join(dist, "apps"));
  for (const f of files) writeFileSync(join(dist, f), `{"f":"${f}"}\n`);
  return dist;
}

const ALL = ["org.json", "org.schema.json", "app.schema.json", "apps/orazaka.json"];

describe("the CDN publish", () => {
  it("is a no-op with a warning when the secrets are missing", async () => {
    const lines: string[] = [];
    expect(config({})).toBeNull();
    const sent = await publish({ dist: makeDist(ALL), env: {}, log: (l: string) => lines.push(l), fetchImpl: () => Promise.reject(new Error("no network expected")) });
    expect(sent).toBe(0);
    expect(lines.join("\n")).toMatch(/not published/);
  });

  it("plans a stable and a hashed copy of each file", () => {
    const paths: string[] = plan(makeDist(ALL)).map((f: { path: string }) => f.path);
    expect(paths).toContain("org/v1/org.json");
    expect(paths).toContain("org/v1/apps/orazaka.json");
    expect(paths.filter((p) => /org\.[0-9a-f]{10}\.json$/.test(p))).toHaveLength(1);
    expect(paths).toHaveLength(8);
  });

  it("sends everything with the key in a header, never in a log, then checks the pull zone", async () => {
    const sent: { url: string; key?: string }[] = [];
    const logs: string[] = [];
    const fetchImpl = (url: string, init?: { headers?: Record<string, string> }) => {
      sent.push({ url, key: init?.headers?.AccessKey });
      return Promise.resolve({ ok: true, status: 200 });
    };
    const count = await publish({ dist: makeDist(ALL), env: { MEDIA_STORAGE_API_KEY: KEY, MEDIA_STORAGE_ZONE: "zone" }, fetchImpl, log: (l: string) => logs.push(l) });
    expect(count).toBe(8);
    expect(sent.filter((s) => s.key === KEY)).toHaveLength(8);
    expect(sent.at(-1)?.url).toMatch(/^https:\/\/krizaka-assets\.b-cdn\.net\/org\/v1\/org\.json/);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("fails loudly when the storage refuses", async () => {
    await expect(
      publish({ dist: makeDist(ALL), env: { MEDIA_STORAGE_API_KEY: KEY, MEDIA_STORAGE_ZONE: "z" }, fetchImpl: () => Promise.resolve({ ok: false, status: 401 }), log: () => {} }),
    ).rejects.toThrow(/401/);
  });
});
