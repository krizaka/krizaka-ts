import { describe, expect, it } from "vitest";

import { CATALOG_SCHEMA, catalogProblems, catalogSchema } from "../catalog/check.js";

const link = {
  name: "Link",
  kind: "component",
  module: "@krizaka/ui/link",
  import: 'import { Link } from "@krizaka/ui/link";',
  summary: "A link to another page or site.",
  status: "stable",
  tags: ["navigation", "anchor"],
  props: [{ name: "href", type: "string", required: true, description: "Where it goes." }],
  examples: [{ title: "Inline", code: '<Link href="/pricing">Pricing</Link>' }],
  rules: { do: ["Say where it goes."], dont: [{ when: "It runs an action", use: "button" }] },
};
const catalog = { schema: CATALOG_SCHEMA, library: "@krizaka/ui", version: "4.10.0", language: "typescript", entries: [link] };

describe("krizaka-catalog/v1", () => {
  it("names itself", () => {
    expect(catalogSchema.title).toBe(CATALOG_SCHEMA);
    expect(catalogSchema.$id).toBe("https://ts.krizaka.com/schemas/krizaka-catalog/v1.json");
  });

  it("accepts a valid catalogue", () => {
    expect(catalogProblems(catalog)).toEqual([]);
  });

  it("refuses an entry without an example", () => {
    expect(catalogProblems({ ...catalog, entries: [{ ...link, examples: [] }] })).toEqual(["catalog.entries[0].examples: needs at least 1 item(s)"]);
  });

  it("refuses a missing field, an unknown field, a wrong enum and an empty string", () => {
    const { import: _omitted, ...noImport } = link;
    expect(catalogProblems({ ...catalog, entries: [noImport] })).toEqual(["catalog.entries[0]: misses « import »"]);
    expect(catalogProblems({ ...catalog, extra: 1 })).toEqual(["catalog: unknown field « extra »"]);
    expect(catalogProblems({ ...catalog, entries: [{ ...link, status: "alpha" }] })).toEqual(["catalog.entries[0].status: must be one of experimental, beta, stable, deprecated"]);
    expect(catalogProblems({ ...catalog, entries: [{ ...link, summary: " " }] })).toEqual(["catalog.entries[0].summary: must not be empty"]);
  });

  it("refuses another schema version and a wrong type", () => {
    expect(catalogProblems({ ...catalog, schema: "krizaka-catalog/v2" })).toEqual(['catalog.schema: must be "krizaka-catalog/v1"']);
    expect(catalogProblems({ ...catalog, entries: {} })).toEqual(["catalog.entries: must be an array"]);
    expect(catalogProblems(null)).toEqual(["catalog: must be an object"]);
  });

  it("refuses the same name twice in one module", () => {
    expect(catalogProblems({ ...catalog, entries: [link, link] })).toEqual(["catalog.entries: « Link » of @krizaka/ui/link is listed twice"]);
  });

  it("covers every kind a library ships: TypeScript, Java and Rust", () => {
    const kinds = (catalogSchema.$defs as { entry: { properties: { kind: { enum: string[] } } } }).entry.properties.kind.enum;
    expect(kinds).toEqual(expect.arrayContaining(["component", "function", "type", "spring-starter", "spring-bean", "rust-item"]));
  });
});
