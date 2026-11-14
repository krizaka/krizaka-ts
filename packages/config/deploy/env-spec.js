// The env schema of an app against its DigitalOcean App Platform spec: every key the app reads is declared in the spec, or
// justified in a `notDeclared` map (key → reason). One check for every app (krizaka-internal#3650); no env, no product word.
import { readFileSync } from "node:fs";

import { parse } from "yaml";

/** @typedef {{ key: string, value?: string, type?: string, scope?: string }} SpecEnv */
/** @typedef {Record<string, SpecEnv[]>} SpecEnvs The `envs` of a spec by component name (`web`, `migrate`…); the app-level ones are under `app`. */

/** The shortest reason that says something: « optional » alone is not one. */
export const REASON_MIN_LENGTH = 11;

/** The App Platform component lists of a spec, each entry carrying its own `envs`. */
const COMPONENT_LISTS = ["services", "workers", "jobs", "static_sites", "functions"];

const asEnvs = (/** @type {unknown} */ list) =>
  Array.isArray(list) ? /** @type {SpecEnv[]} */ (list.filter((e) => e && typeof e.key === "string")) : [];

/**
 * The `envs` of an already parsed App spec, by component name; the app-level `envs` are under `app`.
 * @param {unknown} spec
 * @returns {SpecEnvs}
 */
export function specEnvs(spec) {
  const root = /** @type {Record<string, unknown>} */ (spec && typeof spec === "object" ? spec : {});
  /** @type {SpecEnvs} */
  const out = { app: asEnvs(root.envs) };
  for (const list of COMPONENT_LISTS) {
    const components = Array.isArray(root[list]) ? /** @type {Record<string, unknown>[]} */ (root[list]) : [];
    for (const component of components)
      if (typeof component.name === "string") out[component.name] = asEnvs(component.envs);
  }
  return out;
}

/**
 * Reads a DigitalOcean App spec file (YAML, block or flow style) and gives its `envs` by component.
 * @param {string} file
 * @returns {SpecEnvs}
 */
export function readAppSpecEnvs(file) {
  return specEnvs(parse(readFileSync(file, "utf8")));
}

/**
 * What is wrong between an env schema and a deploy spec. Pure: nothing is read here.
 * @param {{
 *   schemaKeys: readonly string[],
 *   envs: SpecEnvs,
 *   components?: readonly string[],
 *   notDeclared?: Readonly<Record<string, string>>,
 * }} input `components`: the components whose `envs` count (default: all). `notDeclared`: the keys the app reads that the spec
 *   leaves out on purpose, each with its reason.
 * @returns {{
 *   missing: string[], stale: string[], undeclaredWithoutReason: string[], declared: string[], plainSecrets: string[], problems: string[],
 * }}
 *   `missing`: in the schema, neither declared nor justified. `stale`: justified but not in the schema, or declared after all.
 *   `undeclaredWithoutReason`: justified with a reason too short. `plainSecrets`: a `SECRET` whose value is not `__KEY__`.
 *   `problems`: one sentence per finding, empty when the spec is right.
 */
export function checkEnvSpec({ schemaKeys, envs, components, notDeclared = {} }) {
  const names = components ?? Object.keys(envs);
  const entries = names.flatMap((name) => envs[name] ?? []);
  const declared = new Map(entries.map((e) => [e.key, e]));
  const schema = new Set(schemaKeys);
  const missing = schemaKeys.filter((k) => !declared.has(k) && !(k in notDeclared));
  const stale = Object.keys(notDeclared).filter((k) => !schema.has(k) || declared.has(k));
  const undeclaredWithoutReason = Object.entries(notDeclared)
    .filter(([, reason]) => reason.length < REASON_MIN_LENGTH)
    .map(([k]) => k);
  const plainSecrets = entries.filter((e) => e.type === "SECRET" && e.value !== `__${e.key}__`).map((e) => e.key);
  const problems = [
    ...missing.map(
      (k) =>
        `${k}: read by the app, not declared in the spec: declare it (a secret as type SECRET), or justify it in notDeclared`,
    ),
    ...stale.map((k) =>
      schema.has(k)
        ? `${k}: declared in the spec: remove it from notDeclared`
        : `${k}: not in the env schema any more: remove it from notDeclared`,
    ),
    ...undeclaredWithoutReason.map((k) => `${k}: notDeclared needs a reason`),
    ...plainSecrets.map((k) => `${k}: a SECRET holds the placeholder __${k}__, never a value`),
  ];
  return { missing, stale, undeclaredWithoutReason, declared: [...declared.keys()], plainSecrets, problems };
}
