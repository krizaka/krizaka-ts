import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { findCodeNames, footerFor, org, orgSchema } from "../src";

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(orgSchema);
const withSite = (patch: Record<string, unknown>) => {
  const copy = structuredClone(org) as unknown as { footer: { sites: Record<string, Record<string, unknown>> } };
  copy.footer.sites.ts = { ...copy.footer.sites.ts, ...patch };
  return copy;
};

describe("footerFor", () => {
  it("resolves every site entry of the org JSON", () => {
    expect(Object.keys(org.footer.sites).sort()).toEqual(["java", "krizaka", "lab", "rust", "ts", "ui"]);
    for (const id of Object.keys(org.footer.sites)) {
      const footer = footerFor(id);
      expect(footer.id).toBe(id);
      expect(footer.groups.length).toBeGreaterThan(0);
      for (const g of footer.groups) expect(g.entries.every((e) => e.group === g.group)).toBe(true);
      expect(footer.social.map((s) => s.id)).toEqual(org.footer.sites[id]!.social);
      expect(footer.legal.map((l) => l.id)).toEqual(org.footer.sites[id]!.legal);
    }
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
