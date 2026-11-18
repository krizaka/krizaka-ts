import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { findCodeNames, footerFor, org, orgSchema } from "../src";

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(orgSchema);
const withSite = (patch: Record<string, unknown>) => {
  const copy = structuredClone(org) as unknown as { footer: { sites: Record<string, Record<string, unknown>> } };
  copy.footer.sites.ts = { ...copy.footer.sites.ts, ...patch };
  return copy;
};

const TWELVE = [
  "krizaka",
  "blog",
  "ui",
  "java",
  "ts",
  "rust",
  "lab",
  "agents",
  "sovkora",
  "verikora",
  "folioviv",
  "kridoc",
];

describe("footerFor, the 12 sites (krizaka-internal#3563)", () => {
  it("resolves every one of the 12 sites", () => {
    for (const id of TWELVE) expect(footerFor(id).id).toBe(id);
  });

  it("carries the four socials, the same on every site", () => {
    for (const id of TWELVE)
      expect(
        footerFor(id).social.map((s) => s.id),
        id,
      ).toEqual(["instagram", "facebook", "youtube", "linkedin"]);
  });

  it("gives Rust a developer footer with its repository and Agents the company footer", () => {
    expect(footerFor("rust").source).toBe("https://github.com/krizaka/krizaka-rust");
    expect(footerFor("rust").version).toBe(true);
    expect([footerFor("agents").source, footerFor("agents").version]).toEqual([null, false]);
  });

  it("never lists a member that is not public and live in any column", () => {
    const live = new Set(org.members.filter((m) => m.visibility === "public" && m.urls.siteLive).map((m) => m.id));
    for (const id of TWELVE)
      for (const g of footerFor(id).groups)
        for (const e of g.entries) expect(live.has(e.id), `${id}/${e.id}`).toBe(true);
    const ids = footerFor("krizaka").groups.flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).not.toContain("agents");
  });
});

describe("footerFor", () => {
  it("resolves every site entry of the org JSON", () => {
    expect(Object.keys(org.footer.sites).sort()).toEqual([
      "agents",
      "blog",
      "folioviv",
      "java",
      "kridoc",
      "krizaka",
      "lab",
      "rust",
      "sovkora",
      "ts",
      "ui",
      "verikora",
    ]);
    for (const id of Object.keys(org.footer.sites)) {
      const footer = footerFor(id);
      expect(footer.id).toBe(id);
      expect(footer.groups.length).toBeGreaterThan(0);
      for (const g of footer.groups) expect(g.entries.every((e) => e.group === g.group)).toBe(true);
      expect(footer.social.map((s) => s.id)).toEqual(org.footer.sites[id]!.social);
      expect(footer.legal.map((l) => l.id)).toEqual(org.footer.sites[id]!.legal);
    }
  });

  it("shows the source, the licence and the version on every developer site, none on krizaka.com", () => {
    for (const id of ["ui", "lab", "java", "ts"]) {
      const footer = footerFor(id);
      expect(footer.source).toBe(`https://github.com/krizaka/krizaka-${id}`);
      expect(footer.license).not.toBeNull();
      expect(footer.version).toBe(true);
    }
    const company = footerFor("krizaka");
    expect([company.source, company.license, company.version]).toEqual([null, null, false]);
  });

  it("gives every site of the org the same family columns, socials and legal links", () => {
    const first = footerFor("krizaka");
    for (const site of org.sites) {
      const footer = footerFor(site.id);
      expect(footer.groups, site.id).toEqual(first.groups);
      expect(footer.social, site.id).toEqual(first.social);
      expect(footer.legal, site.id).toEqual(first.legal);
      expect(footer.line, site.id).toEqual(first.line);
    }
    expect(footerFor("kridoc").groups.flatMap((g) => g.entries.map((e) => e.id))).toContain("kridoc");
  });

  it("gives Java a source link and no Maven Central link", () => {
    const java = footerFor("java");
    expect(java.source).toBe("https://github.com/krizaka/krizaka-java");
    expect(JSON.stringify(org.footer.sites)).not.toMatch(/maven/i);
  });

  it("refuses an unknown site", () => {
    expect(() => footerFor("nope")).toThrow(/Unknown footer site/);
  });

  it("is valid against the published schema, and the schema refuses an unknown social id or family group", () => {
    expect(validate(org)).toBe(true);
    expect(validate(withSite({ social: ["myspace"] }))).toBe(false);
    expect(validate(withSite({ families: ["nope"] }))).toBe(false);
    expect(validate(withSite({ legal: ["cookies"] }))).toBe(false);
  });

  it("holds no code name in any footer string", () => {
    for (const id of Object.keys(org.footer.sites)) {
      expect(findCodeNames(JSON.stringify(footerFor(id)))).toEqual([]);
    }
  });
});
