#!/usr/bin/env node
/* One page per package, generated from the repository this site lives in — never written by hand.

   For every published package of ../packages: its package.json, README.md and CHANGELOG.md, the names it exports (read from
   the TypeScript program of src/index.ts and of each subpath export), and the version npm lists (the registry's `latest`,
   fetched at build — a page never states a version nobody read). Writes
     lib/generated/packages.json        the data the home, the bar and the footer read
     content/docs/<package>.mdx|.fr.mdx the pages (Fumadocs collection), with meta.json / meta.fr.json
   When npm cannot be reached the previous versions are kept; without a previous file the build fails.
   Usage: node scripts/gen-packages.mjs */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { exportsOf, metaOf, orderFromReadme, renderPage, sourceOfExport } from "./packages-lib.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");
const OUT_DATA = join(SITE, "lib", "generated", "packages.json");
const OUT_DOCS = join(SITE, "content", "docs");
const read = (...p) => readFileSync(join(...p), "utf8");
const readIf = (...p) => (existsSync(join(...p)) ? read(...p) : null);

/** The version npm lists as `latest`; `null` when the package was never published. Throws when the registry cannot be reached. */
async function npmVersion(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replaceAll("/", "%2F")}/latest`, {
    headers: { "user-agent": "krizaka-ts-site-build" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`npm answered ${res.status} for ${name}`);
  return (await res.json()).version;
}

function packagesOf(root) {
  const dirs = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, "packages", d.name, "package.json")))
    .map((d) => d.name);
  return dirs.filter((d) => !JSON.parse(read(root, "packages", d, "package.json")).private);
}

const previous = existsSync(OUT_DATA) ? JSON.parse(readFileSync(OUT_DATA, "utf8")) : null;
const dirs = orderFromReadme(read(REPO, "README.md"), packagesOf(REPO));

const packages = [];
for (const dir of dirs) {
  const root = join(REPO, "packages", dir);
  const json = JSON.parse(read(root, "package.json"));
  const exportMap = json.exports ?? {};
  const main = exportMap["."] ?? json.main;
  const entry = main ? join(root, sourceOfExport(main) ?? "src/index.ts") : null; // no "." entry: subpaths only (@krizaka/config)
  const subpaths = Object.entries(exportMap)
    .filter(([path]) => path !== "." && path !== "./package.json")
    .map(([path, target]) => ({ path, exports: exportsOf(join(root, sourceOfExport(target) ?? "")) }));
  let version;
  try {
    version = await npmVersion(json.name);
  } catch (error) {
    const kept = previous?.packages.find((p) => p.name === json.name);
    if (!kept) {
      console.error(
        `gen-packages: npm unreachable (${error.message}) and no previous version of ${json.name} — cannot state a version`,
      );
      process.exit(1);
    }
    console.warn(`gen-packages: npm unreachable (${error.message}) — keeping ${json.name} ${kept.version}`);
    version = kept.version;
  }
  packages.push({
    id: dir,
    name: json.name,
    version,
    description: json.description,
    license: json.license ?? "Apache-2.0",
    node: json.engines?.node ?? null,
    dependencies: json.dependencies ?? {},
    peerDependencies: json.peerDependencies ?? {},
    exports: exportsOf(entry),
    subpaths,
    readme: read(root, "README.md"),
    changelog: readIf(root, "CHANGELOG.md"),
  });
}

mkdirSync(dirname(OUT_DATA), { recursive: true });
writeFileSync(OUT_DATA, `${JSON.stringify({ packages, fetchedAt: new Date().toISOString() }, null, 2)}\n`);

mkdirSync(OUT_DOCS, { recursive: true });
for (const [locale, suffix, metaName] of [
  ["en", "", "meta.json"],
  ["fr", ".fr", "meta.fr.json"],
]) {
  const messages = JSON.parse(read(SITE, "messages", `${locale}.json`));
  for (const pkg of packages)
    writeFileSync(join(OUT_DOCS, `${pkg.id}${suffix}.mdx`), renderPage(pkg, locale, messages));
  writeFileSync(
    join(OUT_DOCS, metaName),
    `${JSON.stringify(
      metaOf(
        messages.site.name,
        packages.map((p) => p.id),
        messages.docs,
      ),
      null,
      2,
    )}\n`,
  );
}

const published = packages.filter((p) => p.version).length;
console.log(
  `gen-packages: ${packages.length} packages (${published} on npm), ${packages.reduce((n, p) => n + p.exports.length, 0)} exported names`,
);
