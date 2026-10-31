import { describe, expect, it } from "vitest";

import { familyEntry, familyName, org } from "../src";

// The naming rule (founder, 2026-10-30, krizaka/krizaka-internal#754): one name per entry, written here only.
describe("the family's names", () => {
  it("calls the company Krizaka and every product by its own name, never prefixed", () => {
    expect(familyName("krizaka")).toBe("Krizaka");
    const products = org.family.filter((e) => e.group === "products");
    expect(products.map((e) => e.name)).toEqual(["Orazaka", "Yomizaka", "Akinaza"]);
    for (const p of products) {
      expect(p.name).not.toMatch(/^Krizaka /);
      expect(p.short).toBe(p.name);
    }
  });

  it("calls every library and tool « Krizaka <X> », its short name the <X>", () => {
    const libraries = org.family.filter((e) => e.group === "open-source");
    expect(libraries.map((e) => e.name)).toEqual([
      "Krizaka UI",
      "Krizaka Java",
      "Krizaka TypeScript",
      "Krizaka Lab",
      "Krizaka Skills",
    ]);
    for (const l of libraries) expect(l.name).toBe(`Krizaka ${l.short}`);
  });

  it("agrees with the products and sites lists: same names, same addresses", () => {
    for (const p of org.products) expect([familyEntry(p.id).name, familyEntry(p.id).url]).toEqual([p.name, p.url]);
    for (const s of org.sites.filter((s) => s.id !== "www")) {
      const id = s.id === "motion" ? "lab" : s.id;
      expect([familyEntry(id).name, familyEntry(id).url]).toEqual([s.name, s.url]);
    }
  });

  it("lists each entry once, in reading order (group, then order inside it)", () => {
    const ids = org.family.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const order = ["krizaka", "products", "open-source", "github"];
    const groups = org.family.map((e) => order.indexOf(e.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it("refuses an unknown id", () => {
    expect(() => familyName("krizaka-ts")).toThrow(/Unknown/);
  });
});
