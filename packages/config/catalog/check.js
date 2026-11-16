// Checks a catalogue against krizaka-catalog/v1 (catalog/schema.json), with no dependency: the schema is the one
// source, read by a small validator of the keywords it uses (SUPPORTED). A keyword outside that set throws, so the
// validator never ignores a rule silently. Then the rule the schema cannot say: one entry per module and name.
import { readFileSync } from "node:fs";

/** @typedef {{ [key: string]: unknown }} Schema */

/** The krizaka-catalog/v1 JSON Schema. @type {Schema} */
export const catalogSchema = JSON.parse(readFileSync(new URL("schema.json", import.meta.url), "utf8"));

/** The schema version a catalogue declares in `schema`. */
export const CATALOG_SCHEMA = "krizaka-catalog/v1";

/** The keywords the validator reads; the annotations it skips. */
export const SUPPORTED = new Set([
  "type",
  "required",
  "additionalProperties",
  "properties",
  "const",
  "enum",
  "items",
  "minItems",
  "minLength",
  "$ref",
]);
const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description"]);

/** @param {unknown} value */
const typeOf = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

/**
 * @param {Schema} schema
 * @param {unknown} value
 * @param {string} at
 * @param {string[]} problems
 */
function validate(schema, value, at, problems) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key) && !ANNOTATIONS.has(key))
      throw new Error(`catalog/check.js: unsupported schema keyword « ${key} » at ${at}`);
  }
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const target = /** @type {Record<string, Schema>} */ (catalogSchema.$defs)[name];
    if (!target) throw new Error(`catalog/check.js: unknown $ref ${schema.$ref}`);
    validate(target, value, at, problems);
    return;
  }
  if ("const" in schema && value !== schema.const) problems.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    problems.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (typeof schema.type === "string" && typeOf(value) !== schema.type) {
    problems.push(`${at}: must be ${schema.type === "array" || schema.type === "object" ? "an" : "a"} ${schema.type}`);
    return;
  }
  if (typeof value === "string" && typeof schema.minLength === "number" && value.trim().length < schema.minLength)
    problems.push(`${at}: must not be empty`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      problems.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.items)
      value.forEach((item, index) => validate(/** @type {Schema} */ (schema.items), item, `${at}[${index}]`, problems));
  }
  if (typeOf(value) === "object") {
    const object = /** @type {Record<string, unknown>} */ (value);
    const properties = /** @type {Record<string, Schema>} */ (schema.properties ?? {});
    for (const key of /** @type {string[]} */ (schema.required ?? []))
      if (!(key in object)) problems.push(`${at}: misses « ${key} »`);
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) validate(properties[key], item, `${at}.${key}`, problems);
      else if (schema.additionalProperties === false) problems.push(`${at}: unknown field « ${key} »`);
    }
  }
}

/**
 * The problems of a catalogue, empty when it is a valid krizaka-catalog/v1 document.
 * @param {unknown} catalog
 * @returns {string[]}
 */
export function catalogProblems(catalog) {
  /** @type {string[]} */
  const problems = [];
  validate(catalogSchema, catalog, "catalog", problems);
  const entries = /** @type {{ entries?: unknown }} */ (catalog)?.entries;
  if (Array.isArray(entries)) {
    const seen = new Set();
    for (const entry of entries) {
      const key = `${entry?.module} ${entry?.name}`;
      if (seen.has(key)) problems.push(`catalog.entries: « ${entry?.name} » of ${entry?.module} is listed twice`);
      seen.add(key);
    }
  }
  return problems;
}
