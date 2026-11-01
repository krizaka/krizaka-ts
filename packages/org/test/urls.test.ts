import { describe, expect, it } from "vitest";

import { apps, org } from "../src";

/** Every https URL in a value, with where it sits. */
function urls(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return value.startsWith("https://") ? [[path, value]] : [];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => urls(v, path ? `${path}.${k}` : k));
  return [];
}

const SELF = new Set(["$schema", "base"]); // `$schema` is published by the release this file belongs to (not there yet when first written); `base` is a folder, not a file

async function answers(url: string): Promise<number> {
  const head = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (head.status !== 405 && head.status !== 403) return head.status;
  return (await fetch(url, { redirect: "follow" })).status;
}

/** A dropped connection is retried (the CDN resets a few of 200 parallel requests now and then, merge-group run of #279); an answer, even a 404, is final. */
async function answersOrRetry(url: string, attempts = 3): Promise<number> {
  for (let i = 1; i < attempts; i++) {
    try {
      return await answers(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500 * i));
    }
  }
  return answers(url).catch(() => 0);
}

describe("every URL in the org JSON answers", () => {
  const all = [...urls(org), ...urls(apps)].filter(([path]) => !SELF.has(path.split(".").pop() ?? ""));
  const unique = [...new Set(all.map(([, url]) => url))];

  it("has URLs to check", () => {
    expect(unique.length).toBeGreaterThan(200); // the brand files, the apps and the central default sets
  });

  it("answers 200 for all of them", async () => {
    const bad: string[] = [];
    for (let i = 0; i < unique.length; i += 8) {
      await Promise.all(
        unique.slice(i, i + 8).map(async (url) => {
          const status = await answersOrRetry(url);
          if (status !== 200) bad.push(`${status} ${url}`);
        }),
      );
    }
    expect(bad).toEqual([]);
  });
});
