import { describe, expect, it } from "vitest";

import { apps, org } from "../src";

/** Every https URL in a value, with where it sits. */
function urls(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return value.startsWith("https://") ? [[path, value]] : [];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => urls(v, path ? `${path}.${k}` : k));
  return [];
}

const SELF = new Set(["$schema", "base"]);
const OUTSIDE = "links."; // the company's accounts on other platforms: not ours to request (they answer a bot with a login wall) // `$schema` is published by the release this file belongs to (not there yet when first written); `base` is a folder, not a file

const TIMEOUT_MS = 15_000;

async function answers(url: string): Promise<number> {
  const init = { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) } as const;
  const head = await fetch(url, { ...init, method: "HEAD" });
  if (head.status !== 405 && head.status !== 403) return head.status;
  return (await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })).status;
}

/** The reason of a failed fetch: undici puts the system error (ECONNRESET, ENOTFOUND…) in `cause`. */
export function reasonOf(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  return cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error));
}

/** A host that no longer resolves is dead, not flaky. */
export function isDead(reason: string): boolean {
  return reason === "ENOTFOUND";
}

type Outcome =
  { kind: "status"; status: number } | { kind: "flaky"; reason: string } | { kind: "dead"; reason: string };

/** An answer, even a 404, is final. A dropped connection is retried once (the CDN resets a few of 200 parallel requests now and then: merge-group run of #279, main run 43120189176) and, if it drops again, reported with its reason as a warning: a third party's hiccup never turns main red, but never vanishes either. A host that does not resolve fails. */
export async function check(url: string, fetchStatus = answers, pause = 1000): Promise<Outcome> {
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { kind: "status", status: await fetchStatus(url) };
    } catch (error) {
      reason = reasonOf(error);
      if (isDead(reason)) return { kind: "dead", reason };
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
  return { kind: "flaky", reason };
}

describe("every URL in the org JSON answers", () => {
  const all = [...urls(org), ...urls(apps)].filter(
    ([path]) => !SELF.has(path.split(".").pop() ?? "") && !path.startsWith(OUTSIDE),
  );
  const unique = [...new Set(all.map(([, url]) => url))];

  it("has URLs to check", () => {
    expect(unique.length).toBeGreaterThan(200); // the brand files, the apps and the central default sets
  });

  it("answers 200 for all of them", async () => {
    const bad: string[] = [];
    for (let i = 0; i < unique.length; i += 8) {
      await Promise.all(
        unique.slice(i, i + 8).map(async (url) => {
          const outcome = await check(url);
          if (outcome.kind === "dead") bad.push(`${outcome.reason} ${url}`);
          else if (outcome.kind === "flaky")
            console.warn(`network error (${outcome.reason}) after one retry, not a dead URL: ${url}`);
          else if (outcome.status !== 200) bad.push(`${outcome.status} ${url}`);
        }),
      );
    }
    expect(bad).toEqual([]);
  });
});

describe("check", () => {
  const reset = () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }));
  it("retries a dropped connection once and returns the answer", async () => {
    let calls = 0;
    const outcome = await check("u", () => (calls++ === 0 ? reset() : Promise.resolve(200)), 0);
    expect(outcome).toEqual({ kind: "status", status: 200 });
    expect(calls).toBe(2);
  });
  it("reports a connection that drops twice as flaky with its reason", async () => {
    expect(await check("u", reset, 0)).toEqual({ kind: "flaky", reason: "ECONNRESET" });
  });
  it("fails a host that does not resolve, without retry", async () => {
    let calls = 0;
    const gone = () => {
      calls++;
      return Promise.reject(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }));
    };
    expect(await check("u", gone, 0)).toEqual({ kind: "dead", reason: "ENOTFOUND" });
    expect(calls).toBe(1);
  });
  it("keeps a 404 final", async () => {
    expect(await check("u", () => Promise.resolve(404), 0)).toEqual({ kind: "status", status: 404 });
  });
});
