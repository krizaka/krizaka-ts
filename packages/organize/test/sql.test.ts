import { describe, expect, it } from "vitest";

import { ident, organizeMigration } from "../src";

describe("the migration", () => {
  it("only lets a safe identifier reach SQL", () => {
    expect(ident("shops")).toBe("shops");
    for (const bad of ["Shops", "a-b", "a;drop table x", "", "x".repeat(70), "1abc"]) expect(() => ident(bad), bad).toThrow(/safe SQL identifier/);
    expect(() => organizeMigration({ kinds: { shop: { table: "shops; DROP" } } })).toThrow();
  });
  it("declares the invariants: one default per owner, no deletion, the owner makes it, entities fall into it", () => {
    const sql = organizeMigration({ kinds: { shop: { table: "shops" } } });
    for (const needle of ["EXCLUDE USING btree (owner_id WITH =) WHERE (is_default)", "collections_guard_default", "collections_exactly_one_default", "collections_owner_default", "shops_default_collection", "shops_tags"]) expect(sql).toContain(needle);
  });
  it("a kind outside collections gets tags but no collection column", () => {
    const sql = organizeMigration({ kinds: { note: { table: "notes", inCollection: false } } });
    expect(sql).toContain("notes_tags");
    expect(sql).not.toContain("notes_default_collection");
  });
});
