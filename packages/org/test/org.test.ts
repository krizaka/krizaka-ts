import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { apps, appSchema, footerLine, org, orgSchema } from "../src";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const text = JSON.stringify(org);

describe("the org JSON", () => {
  it("validates against its schema", () => {
    const validate = ajv.compile(orgSchema);
    expect(validate(org), JSON.stringify(validate.errors)).toBe(true);
  });

  it("refuses a fact the schema does not know", () => {
    const validate = ajv.compile(orgSchema);
    expect(validate({ ...org, address: "1 rue Exemple" })).toBe(false);
    expect(validate({ ...org, company: { ...org.company, phone: "514" } })).toBe(false);
  });

  it("carries the identity every footer shows", () => {
    expect(org.company.legalName).toBe("Technologies Krizaka Inc.");
    expect(org.company.neq).toMatch(/^\d{10}$/);
    expect(org.company.madeIn).toEqual({ fr: "Fait à Montréal", en: "Made in Montréal" });
    expect(footerLine("fr")).toBe("Une entreprise de Technologies Krizaka · Fait à Montréal");
    expect(footerLine("en")).toBe("A Technologies Krizaka company · Made in Montréal");
    expect(org.footer.legal.map((l) => l.id)).toEqual(["privacy", "terms"]);
  });

  it("lists only the live products", () => {
    expect(org.products.map((p) => p.id)).toEqual(["orazaka", "yomizaka", "akinaza"]);
  });

  it("holds public facts only: no address, phone, figure, secret or IP", () => {
    expect(text).not.toMatch(/\+?\d{3}[ -.]\d{3}[ -.]\d{4}/); // a phone number
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/); // an IPv4
    expect(text).not.toMatch(/\b(rue|avenue|boulevard|street|suite)\b/i); // a street address
    expect(text).not.toMatch(/localhost|\.internal|\.local\b|10\.\d+\.|192\.168\./i); // an internal host
    expect(text).not.toMatch(/secret|token|password|api[_-]?key|bearer|sk_[a-z]+_|-----BEGIN/i);
    expect(text).not.toMatch(/revenue|chiffre d'affaires|\$\s?\d/i); // financial figures
    expect(Object.keys(org.company)).not.toContain("address");
  });

  it("serves every language: each localized pair is filled and different", () => {
    for (const a of org.people.defaults) expect(a.alt.fr).not.toBe(a.alt.en);
    expect(org.footer.line.fr).not.toBe(org.footer.line.en);
  });
});

describe("the apps' runtime config", () => {
  it("has one validated file per live product", () => {
    const validate = ajv.compile(appSchema);
    expect(Object.keys(apps)).toEqual(org.products.map((p) => p.id));
    for (const [id, config] of Object.entries(apps)) {
      expect(config.app).toBe(id);
      expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("holds no secret", () => {
    expect(JSON.stringify(apps)).not.toMatch(/secret|token|password|api[_-]?key|bearer|-----BEGIN/i);
  });

  it("refuses a field the schema does not know", () => {
    const validate = ajv.compile(appSchema);
    expect(validate({ ...apps.orazaka, apiKey: "x" })).toBe(false);
  });
});
