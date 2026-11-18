import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { brands, family, familyEntry, familyName, org, orgSchema } from "../src";

// The naming rule (founder, 2026-10-30, krizaka/krizaka-internal#754): one name per entry, written here only.
describe("the family's names", () => {
  it("calls the company Krizaka and every product by its own name, never prefixed", () => {
    expect(familyName("krizaka")).toBe("Krizaka");
    const products = org.family.filter((e) => e.group === "products");
    expect(products.map((e) => e.name)).toEqual(["Sovkora", "Verikora", "Folioviv", "Kridoc"]);
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
      "Krizaka Rust",
    ]);
    for (const l of libraries) expect(l.name).toBe(`Krizaka ${l.short}`);
  });

  it("is a system of the family: `kridoc` is an entry the architecture tool can extend (krizaka-internal#3561)", () => {
    expect(familyEntry("kridoc")).toMatchObject({
      group: "products",
      status: "development",
      url: "https://www.kridoc.com",
    });
  });

  it("agrees with the products and sites lists: same names, same addresses", () => {
    for (const p of org.products) expect([familyEntry(p.id).name, familyEntry(p.id).url]).toEqual([p.name, p.url]);
    for (const s of org.sites.filter((s) => s.id !== "krizaka")) {
      expect([familyEntry(s.id).name, familyEntry(s.id).url]).toEqual([s.name, s.url]);
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

// The one family table (krizaka-internal#3913): every list is a filter of it.
describe("the family table", () => {
  const publicRows = family.filter((m) => m.visibility === "public");

  it("is exported, one row per id", () => {
    expect(new Set(family.map((m) => m.id)).size).toBe(family.length);
  });

  it("computes `products` from it", () => {
    const expected = publicRows
      .filter((m) => m.kind === "product")
      .map((m) => [m.id, m.name, m.status, m.urls.site, m.urls.repo]);
    expect(org.products.map((p) => [p.id, p.name, p.status, p.url, p.repo])).toEqual(expected);
  });

  it("computes `sites` from it: a live site with a bird", () => {
    const expected = publicRows.filter((m) => m.urls.siteLive && m.mascot && m.kind !== "github").map((m) => m.id);
    expect(org.sites.map((s) => s.id)).toEqual(expected);
    for (const s of org.sites) expect(s.url).toBe(family.find((m) => m.id === s.id)?.urls.site);
  });

  it("computes the family groups from it", () => {
    expect(org.family.map((e) => e.id)).toEqual(publicRows.map((m) => m.id));
  });

  it("computes `brands` from it: the public products", () => {
    expect(brands.map((b) => b.id)).toEqual(publicRows.filter((m) => m.kind === "product").map((m) => m.id));
  });

  it("publishes the public rows only, as `members`", () => {
    expect(org.members).toEqual(publicRows);
  });

  it("gives Kridoc one kind: a product, in the products group, brand and site", () => {
    expect(family.filter((m) => m.id === "kridoc").map((m) => m.kind)).toEqual(["product"]);
    expect(familyEntry("kridoc").group).toBe("products");
    expect(brands.find((b) => b.id === "kridoc")?.kind).toBe("product");
    expect(org.sites.find((s) => s.id === "kridoc")?.kind).toBe("product");
  });

  it("has Krizaka Rust: open source, in development, its site is the link and its repository the source (krizaka-internal#4114)", () => {
    const rust = family.find((m) => m.id === "rust");
    expect(rust).toMatchObject({ kind: "library", group: "open-source", status: "development", visibility: "public" });
    expect(rust?.urls).toMatchObject({
      site: "https://rust.krizaka.com",
      siteLive: true,
      repo: "https://github.com/krizaka/krizaka-rust",
    });
    expect(familyEntry("rust").url).toBe("https://rust.krizaka.com");
    expect(familyEntry("rust").repo).toBe("https://github.com/krizaka/krizaka-rust");
    expect(org.sites.map((s) => s.id)).not.toContain("rust");
  });

  it("keeps Krizaka Agents private and out of every public view", () => {
    const agents = family.find((m) => m.id === "agents");
    expect(agents).toMatchObject({ kind: "product", visibility: "private" });
    expect(agents?.urls.repo).toBeNull();
    expect(org.products.map((p) => p.id)).not.toContain("agents");
    expect(org.sites.map((s) => s.id)).not.toContain("agents");
    expect(org.family.map((e) => e.id)).not.toContain("agents");
    expect(brands.map((b) => b.id)).not.toContain("agents");
    // Its footer selection (`footer.sites.agents`, krizaka-internal#3563) is the one key it may have: a selection, not a view.
    const { sites: _selections, ...footer } = org.footer;
    expect(JSON.stringify({ ...org, footer })).not.toMatch(/agents/i);
  });

  it("requires a bird of every member whose site is live, and the date of a release", () => {
    for (const m of family) {
      // Rust has no bird yet: its site is a link, not an entry of org.sites (which needs a bird).
      if (m.urls.siteLive && m.kind !== "github" && m.id !== "rust") expect(m.mascot, m.id).toBeDefined();
      if (m.status === "released" && m.kind === "product") expect(m.releasedAt, m.id).toBeDefined();
    }
  });

  it("validates against the JSON Schema, and refuses a private row", () => {
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(orgSchema);
    expect(validate(JSON.parse(JSON.stringify(org))), JSON.stringify(validate.errors)).toBe(true);
    const agents = family.find((m) => m.id === "agents");
    expect(validate({ ...org, members: [...org.members, agents] })).toBe(false);
  });
});
