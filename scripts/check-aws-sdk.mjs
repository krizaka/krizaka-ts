#!/usr/bin/env node
/* The AWS SDK stays behind the ports (krizaka-internal#4194): a package imports it only from `src/adapters/s3/` or
   `src/adapters/aws-kms/`, so a product never depends on a vendor. Today the S3 adapter speaks Signature V4 over `fetch` and
   nothing imports the SDK; this guard keeps it that way.
     node scripts/check-aws-sdk.mjs        exits 1 and lists every import of the SDK outside those two folders */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SDK = String.raw`(?:@aws-sdk\/[\w.-]+|aws-sdk(?:\/[\w./-]*)?|@smithy\/[\w.-]+|@aws-crypto\/[\w.-]+)`;
const IMPORT = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|^\s*import\s+)["'](${SDK})["']`,
  "gm",
);
const ALLOWED = [/(^|\/)src\/adapters\/s3\//, /(^|\/)src\/adapters\/aws-kms\//];
const SKIP = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

/** The SDK modules a source imports (static, dynamic or `require`). */
export const sdkImports = (source) => [...source.matchAll(IMPORT)].map((m) => m[1]);

/** True when `path` (relative, `/` separated) is one of the adapter folders allowed to import the SDK. */
export const mayImportSdk = (path) => ALLOWED.some((re) => re.test(path));

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : sources(path);
    return /\.[cm]?[jt]sx?$/.test(e.name) ? [path] : [];
  });
}

/** Every `{ file, module }` that imports the SDK from outside the adapters, under `packages/*\/src`. */
export function violations(root) {
  const out = [];
  for (const pkg of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    let files = [];
    try {
      files = sources(join(root, "packages", pkg.name, "src"));
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = relative(root, file).split(sep).join("/");
      if (mayImportSdk(rel)) continue;
      for (const module of sdkImports(readFileSync(file, "utf8"))) out.push({ file: rel, module });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = violations(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
  for (const v of found)
    console.error(`${v.file}: imports ${v.module} outside src/adapters/s3 and src/adapters/aws-kms`);
  if (found.length) process.exit(1);
  console.log("no AWS SDK import outside the adapters");
}
