/* The packages the site documents, read at build from lib/generated/packages.json (scripts/gen-packages.mjs: the package.json,
   the exports and the version npm lists). Nothing about a package — its name, its version, what it exports — is typed here. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "lib", "generated", "packages.json");

export interface PackageExport {
  name: string;
  kind: "function" | "class" | "const" | "type" | "enum";
  summary: string;
}

export interface PackageInfo {
  /** The folder name, and the page: `api-keys` → `/api-keys/`. */
  id: string;
  /** The npm name: `@krizaka/api-keys`. */
  name: string;
  /** The version npm lists as `latest`; null when the package was never published. */
  version: string | null;
  description: string;
  license: string;
  node: string | null;
  exports: PackageExport[];
  subpaths: { path: string; exports: PackageExport[] }[];
}

let cache: PackageInfo[] | null = null;

/** The packages, in the order of the repository README's table. */
export function packages(): PackageInfo[] {
  if (!cache) {
    if (!existsSync(FILE)) throw new Error("lib/generated/packages.json is missing — run `npm run gen`");
    cache = (JSON.parse(readFileSync(FILE, "utf8")) as { packages: PackageInfo[] }).packages;
  }
  return cache;
}

/** The version of a package on npm (`@krizaka/auth` → `0.3.0`); null when it was never published. */
export const npmVersion = (name: string): string | null => packages().find((p) => p.name === name)?.version ?? null;

/** Every name a package exports, its subpaths included. */
export const exportedNames = (p: PackageInfo): number => p.exports.length + p.subpaths.reduce((n, s) => n + s.exports.length, 0);
