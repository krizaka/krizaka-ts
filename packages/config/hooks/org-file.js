// Why: the chain checks against files the org keeps public in krizaka/.github (the identity allow-list, the secret-scan rules);
//   a contributor has no clone of it.
// What: reads one such file from raw.githubusercontent.com, cached one day under ~/.cache/krizaka/hooks. Offline: the stale
//   cache; no cache either: null (the step then says so and lets the commit through, CI is the last word).
// How: `await readOrgFile("scripts/commit-identities.json")`; the fetcher and cache folder are parameters for the tests.
// Owner: platform lane (krizaka-ts, @krizaka/config).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE = "https://raw.githubusercontent.com/krizaka/.github/main/";
const DAY_MS = 86_400_000;

/**
 * @typedef {{ cache?: string, fetcher?: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean, text: () => Promise<string> }>, now?: number }} Options
 */

/**
 * @param {string} path the file in krizaka/.github
 * @param {Options} [options]
 * @returns {Promise<string | null>}
 */
export async function readOrgFile(path, options = {}) {
  const cache = join(options.cache ?? join(homedir(), ".cache", "krizaka", "hooks"), path.replaceAll("/", "__"));
  const stale = readCache(cache);
  if (stale && (options.now ?? Date.now()) - stale.at < DAY_MS) return stale.text;
  try {
    const response = await (options.fetcher ?? fetch)(BASE + path, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return stale?.text ?? null;
    const text = await response.text();
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, text);
    return text;
  } catch {
    return stale?.text ?? null;
  }
}

/** @param {string} file */
function readCache(file) {
  try {
    return { text: readFileSync(file, "utf8"), at: statSync(file).mtimeMs };
  } catch {
    return null;
  }
}
