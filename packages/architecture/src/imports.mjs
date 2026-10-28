// What a source file says about its neighbours: the modules it imports and the environment it reads.
import { posix } from "node:path";

import { asc } from "./order.mjs";

const SPECIFIERS = [
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const CONTEXTS = "APP|DATABASE|AUTH|MEDIA|MAIL|PUSH|PAYMENTS|REALTIME|ABUSE|OBSERVABILITY|AI|OPERATOR";
const ENV_NAME = new RegExp(String.raw`\b((?:NEXT_PUBLIC_)?(?:${CONTEXTS})_[A-Z0-9_]*[A-Z0-9])\b`, "g");
const ENV_ONLY = new RegExp(`^(?:NEXT_PUBLIC_)?(?:${CONTEXTS})_[A-Z0-9_]*[A-Z0-9]$`);
const PROCESS_ENV = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]+)/g;

/** The module specifiers a source names, in source order. */
export const specifiersOf = (source) => SPECIFIERS.flatMap((re) => [...source.matchAll(re)]).sort((a, b) => a.index - b.index).map((m) => m[1]);

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`; a relative, alias or built-in path -> undefined. */
export function packageOf(specifier) {
  if (/^(?:[./]|@\/|~\/|node:)/.test(specifier)) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The repo path a relative (`./x`, `../x`) or root-alias (`@/x`, `~/x`) specifier points to, extension-less. */
export function localTarget(specifier, fromFile, containerDir) {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  if (/^[@~]\//.test(specifier)) return posix.join(containerDir === "." ? "" : containerDir, specifier.slice(2));
  return undefined;
}

const strip = (names) => names.map((n) => n.replace(/^NEXT_PUBLIC_/, ""));

/** The env names of the declared contexts: every one a declaration file lists, only the ones a source file reads. */
export function envNamesOf(source, { declaration }) {
  const found = declaration ? [...source.matchAll(ENV_NAME)].map((m) => m[1]) : [...source.matchAll(PROCESS_ENV)].map((m) => m[1]).filter((n) => ENV_ONLY.test(n));
  return [...new Set(strip(found))].sort(asc);
}

/** The context of an env name (`MAIL_PROVIDER` -> `MAIL`). */
export const contextOf = (name) => name.split("_")[0];
