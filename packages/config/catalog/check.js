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
function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/** @typedef {(schema: Schema, value: unknown, at: string, problems: string[]) => void} Check */

/** @param {Schema} schema */
function resolved(schema) {
  if (typeof schema.$ref !== "string") return schema;
  const target = /** @type {Record<string, Schema>} */ (catalogSchema.$defs)[schema.$ref.replace(/^#\/\$defs\//, "")];
  if (!target) throw new Error(`catalog/check.js: unknown $ref ${schema.$ref}`);
  return target;
}

/** @type {Check} */
const checkValue = (schema, value, at, problems) => {
  if ("const" in schema && value !== schema.const) problems.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    problems.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string" && typeof schema.minLength === "number" && value.trim().length < schema.minLength)
    problems.push(`${at}: must not be empty`);
};

/** @type {Check} */
const checkArray = (schema, value, at, problems) => {
  if (!Array.isArray(value)) return;
  if (typeof schema.minItems === "number" && value.length < schema.minItems)
    problems.push(`${at}: needs at least ${schema.minItems} item(s)`);
  const items = /** @type {Schema | undefined} */ (schema.items);
  if (items) value.forEach((item, index) => validate(items, item, `${at}[${index}]`, problems));
};

/** @type {Check} */
const checkObject = (schema, value, at, problems) => {
  if (typeOf(value) !== "object") return;
  const object = /** @type {Record<string, unknown>} */ (value);
  const properties = /** @type {Record<string, Schema>} */ (schema.properties ?? {});
  for (const key of /** @type {string[]} */ (schema.required ?? []))
    if (!(key in object)) problems.push(`${at}: misses « ${key} »`);
  for (const [key, item] of Object.entries(object)) {
    if (properties[key]) validate(properties[key], item, `${at}.${key}`, problems);
    else if (schema.additionalProperties === false) problems.push(`${at}: unknown field « ${key} »`);
  }
};

/** @type {Check} */
function validate(raw, value, at, problems) {
  const unknown = Object.keys(raw).find((key) => !SUPPORTED.has(key) && !ANNOTATIONS.has(key));
  if (unknown) throw new Error(`catalog/check.js: unsupported schema keyword « ${unknown} » at ${at}`);
  const schema = resolved(raw);
  checkValue(schema, value, at, problems);
  if (typeof schema.type === "string" && typeOf(value) !== schema.type) {
    problems.push(`${at}: must be ${["array", "object"].includes(schema.type) ? "an" : "a"} ${schema.type}`);
    return;
  }
  checkArray(schema, value, at, problems);
  checkObject(schema, value, at, problems);
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
