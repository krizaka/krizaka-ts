#!/usr/bin/env node
/* Guard for krizaka-internal#4620: a vulnerable glob/esbuild must not come back via transitive resolution or a
   lockfile edit. Checks every resolved package in `pnpm-lock.yaml` against the minimum safe floors below.
     node scripts/check-advisories.mjs     exits 1 and lists every package below its advisory floor */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Minimum safe versions enforced per package; `from` restricts the check to versions `>= from`. */
export const floors = {
  glob: { min: "14.0.2", from: "9.0.0" },
  esbuild: { min: "0.28.1" },
};

/** Numeric semver comparison on `major.minor.patch` (`-1`, `0`, or `1`). */
export function cmp(a, b) {
  const pa = a.split(/[+-]/, 1)[0].split(".").map(Number);
  const pb = b.split(/[+-]/, 1)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The `name@version` of a lockfile key line (`  '@s/x@1.0.0(peer@1)':`), or `null` when the line is not a key. */
function keyOf(line) {
  if (!line.startsWith("  ") || line.startsWith("   ") || !line.endsWith(":")) return null;
  const quoted = line.slice(2, -1).replaceAll("'", "").replaceAll('"', "");
  const peer = quoted.indexOf("(");
  return (peer < 0 ? quoted : quoted.slice(0, peer)).replace(/:$/, "");
}

/** Every `{ name, version }` entry in the top-level `packages:` section of a pnpm v9 lockfile. */
export function resolved(lockText) {
  const lines = lockText.split(/\r?\n/);
  const start = lines.indexOf("packages:");
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && line !== "" && !line.startsWith(" "));
  const section = lines.slice(start + 1, end < 0 ? undefined : end);
  return section.flatMap((line) => {
    const key = keyOf(line);
    const at = key?.indexOf("@", 1) ?? -1;
    return key && at > 0 ? [{ name: key.slice(0, at), version: key.slice(at + 1) }] : [];
  });
}

/** Every advisory violation in `lockText`, formatted as `"<name>@<version> (needs >= <min>)"`. */
export function violations(lockText) {
  const out = [];
  for (const { name, version } of resolved(lockText)) {
    if (!Object.hasOwn(floors, name)) continue;
    const floor = floors[name];
    if (floor.from && cmp(version, floor.from) < 0) continue;
    if (cmp(version, floor.min) < 0) out.push(`${name}@${version} (needs >= ${floor.min})`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lockPath = join(fileURLToPath(new URL(".", import.meta.url)), "..", "pnpm-lock.yaml");
  const found = violations(readFileSync(lockPath, "utf8"));
  for (const v of found) console.error(v);
  if (found.length) process.exit(1);
  console.log("no advisory violations in pnpm-lock.yaml");
}
