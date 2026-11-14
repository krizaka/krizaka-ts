// The daily watch of the org JSON's URLs (krizaka-internal#3669). It was a unit test that fetched every URL one after another: a
// third party's 502 or a slow network failed every push and took a PR out of the merge queue. Liveness is a property of the
// network, so it is watched on a schedule: this script fetches them in parallel (bounded), with a timeout per URL and one retry,
// and writes, per host, whether it is `red` (dead URLs) or `green`, for one alert `org-urls/<host>` each. Never a gate.
//
//   node scripts/org-urls-watch.mjs <output.json>      (needs `pnpm --filter @krizaka/org build` first)
//
// Writes `<output.json>`: [{ host, state, body }] for every host, and `matrix=<that JSON, one line>` to $GITHUB_OUTPUT.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CONCURRENCY = 8;
export const TIMEOUT_MS = 15_000;
const MAX_LISTED = 40; // one alert body stays readable

const SELF = new Set(["$schema", "base"]); // `$schema` is published by the release this file belongs to; `base` is a folder
const OUTSIDE = "links."; // the company's accounts on other platforms answer a bot with a login wall: not ours to request

/** Every https URL of a value, with where it sits. */
export function urlsOf(value, path = "") {
  if (typeof value === "string") return value.startsWith("https://") ? [[path, value]] : [];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => urlsOf(v, path ? `${path}.${k}` : k));
  return [];
}

/** The distinct URLs to request, in order. */
export function watched(...documents) {
  const all = documents.flatMap((doc) => urlsOf(doc));
  const kept = all.filter(([path]) => !SELF.has(path.split(".").pop() ?? "") && !path.startsWith(OUTSIDE));
  return [...new Set(kept.map(([, url]) => url))];
}

/** HEAD, then GET when the server refuses HEAD. */
export async function answers(url, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const init = () => ({ redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  const head = await fetchImpl(url, { ...init(), method: "HEAD" });
  if (head.status !== 405 && head.status !== 403) return head.status;
  return (await fetchImpl(url, init())).status;
}

/** The reason of a failed fetch: undici puts the system error (ECONNRESET, ENOTFOUND…) in `cause`. */
export function reasonOf(error) {
  const cause = error?.cause;
  return cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error));
}

/** An answer, even a 404, is final; a failure (reset, timeout, 5xx) is tried once more after `pause`. Resolves to `null` when the URL is alive, else the reason. */
export async function check(url, fetchStatus = answers, pause = 1000) {
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const status = await fetchStatus(url);
      if (status === 200) return null;
      reason = String(status);
      if (status < 500) return reason; // a 404 is final
    } catch (error) {
      reason = reasonOf(error);
      if (reason === "ENOTFOUND") return reason; // a host that does not resolve is dead, not flaky
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return reason;
}

/** `task` over `items`, at most `limit` at a time, results in order. */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** One entry per host, `green` or `red`, with the alert body naming the dead URLs. */
export function reportByHost(urls, reasons) {
  const hosts = new Map();
  urls.forEach((url, i) => {
    const host = new URL(url).hostname;
    const dead = hosts.get(host) ?? [];
    if (reasons[i] !== null) dead.push(`${reasons[i]} ${url}`);
    hosts.set(host, dead);
  });
  return [...hosts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, dead]) => ({
      host,
      state: dead.length ? "red" : "green",
      body: dead.length
        ? `${dead.length} URL(s) of the org JSON on \`${host}\` do not answer 200 (daily watch \`org-urls\`, one retry done):\n\n${dead
            .slice(0, MAX_LISTED)
            .map((line) => `- ${line}`)
            .join("\n")}${dead.length > MAX_LISTED ? `\n- … and ${dead.length - MAX_LISTED} more` : ""}\n`
        : `Every URL of the org JSON on \`${host}\` answers 200.\n`,
    }));
}

async function main(output) {
  const dist = join(fileURLToPath(new URL("..", import.meta.url)), "packages", "org", "dist", "index.js");
  const { org, apps } = await import(pathToFileURL(dist).href);
  const urls = watched(org, apps);
  const reasons = await mapLimit(urls, CONCURRENCY, (url) => check(url));
  const report = reportByHost(urls, reasons);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(report)}\n`);
  for (const { host, state } of report) process.stdout.write(`${state} ${host}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv[2] ?? "org-urls.json");
