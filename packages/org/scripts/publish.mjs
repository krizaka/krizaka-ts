#!/usr/bin/env node
// Publishes the org JSON to the CDN's storage zone: a stable address and an immutable hashed copy of every file.
//
//   node scripts/publish.mjs [--dry-run]       (after `pnpm build`)
//
//   org/v1/org.json            org/v1/org.<hash>.json            the facts
//   org/v1/org.schema.json     org/v1/org.schema.<hash>.json     their JSON Schema
//   org/v1/app.schema.json     …                                 the schema of an app's runtime config
//   org/v1/apps/<product>.json org/v1/apps/<product>.<hash>.json each mobile app's public runtime config
//
// Credentials come from the environment and are never printed: the storage zone's key and name (MEDIA_STORAGE_*), the endpoint
// (default storage.bunnycdn.com) and the pull zone's host (default krizaka-assets.b-cdn.net). Without the key or the zone the
// script says so and stops with code 0, so a release is never blocked by a missing secret (the CI job warns).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "org/v1";

/** The files to send: [{ path, body }], the stable name and its hashed copy for each source file. */
export function plan(dist) {
  const sources = ["org.json", "org.schema.json", "app.schema.json", ...readdirSync(join(dist, "apps")).map((name) => `apps/${name}`)];
  return sources.flatMap((name) => {
    const body = readFileSync(join(dist, name));
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 10);
    return [{ path: `${ROOT}/${name}`, body }, { path: `${ROOT}/${name.replace(/\.json$/, `.${hash}.json`)}`, body }];
  });
}

/** Reads the credentials; `null` when a required one is missing. */
export function config(env) {
  const apiKey = env.MEDIA_STORAGE_API_KEY;
  const zone = env.MEDIA_STORAGE_ZONE;
  if (!apiKey || !zone) return null;
  return { apiKey, zone, endpoint: env.MEDIA_STORAGE_ENDPOINT || "storage.bunnycdn.com", host: env.MEDIA_CDN_HOSTNAME || "krizaka-assets.b-cdn.net" };
}

export async function publish({ dist, env, dryRun = false, fetchImpl = globalThis.fetch, log = console.log }) {
  const files = plan(dist);
  if (dryRun) {
    for (const f of files) log(`would send ${f.path} (${f.body.length} bytes)`);
    return files.length;
  }
  const cfg = config(env);
  if (!cfg) {
    log("::warning::The storage zone's key and name are not set (MEDIA_STORAGE_*): the org JSON is not published");
    return 0;
  }
  for (const f of files) {
    const url = `https://${cfg.endpoint}/${encodeURIComponent(cfg.zone)}/${f.path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetchImpl(url, { method: "PUT", headers: { AccessKey: cfg.apiKey, "Content-Type": "application/json; charset=utf-8" }, body: f.body });
    if (!res.ok) throw new Error(`${f.path}: storage answered ${res.status}`);
    log(`sent ${f.path}`);
  }
  // The pull zone must serve the stable file, or the release published nothing readers can use.
  const check = await fetchImpl(`https://${cfg.host}/${ROOT}/org.json?v=${Date.now()}`);
  if (!check.ok) throw new Error(`https://${cfg.host}/${ROOT}/org.json answered ${check.status}`);
  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = join(fileURLToPath(new URL("..", import.meta.url)), "dist");
  await publish({ dist, env: process.env, dryRun: process.argv.includes("--dry-run") });
}
