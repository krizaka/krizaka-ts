// After `changeset publish`: every package it reports as published must be visible on npm. npm can lag a few minutes behind a
// green publish (@krizaka/storage@0.3.1 showed 0.3.0 for ~4 min), so a consumer that installs right after the run fails.
// Usage: node scripts/verify-published.mjs '<publishedPackages JSON of changesets/action>'
// Retries with backoff for a few minutes, then fails with the list of missing packages.
import { fileURLToPath } from "node:url";

export function parsePublished(json) {
  const list = JSON.parse(json || "[]");
  return list.map((p) => ({ name: p.name, version: p.version }));
}

/** Returns the packages whose version `visible(name, version)` does not see. */
export async function missingPackages(packages, visible) {
  const missing = [];
  for (const p of packages) if (!(await visible(p.name, p.version))) missing.push(p);
  return missing;
}

/** Retries `check` over `delays` (ms) until nothing is missing; returns the packages still missing. */
export async function waitForPackages(
  packages,
  visible,
  {
    delays = [0, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000],
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  let missing = packages;
  for (const d of delays) {
    if (d) await sleep(d);
    missing = await missingPackages(missing, visible);
    if (missing.length === 0) return [];
  }
  return missing;
}

async function visibleOnNpm(name, version) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, {
      headers: { "cache-control": "no-cache" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packages = parsePublished(process.argv[2]);
  const missing = await waitForPackages(packages, visibleOnNpm);
  if (missing.length > 0) {
    const list = missing.map((p) => `  ${p.name}@${p.version}`).join("\n");
    console.error("Not visible on npm after the publish:\n" + list);
    process.exit(1);
  }
  console.log(`${packages.length} published package(s) visible on npm`);
}
