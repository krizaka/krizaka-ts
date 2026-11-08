import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { apps, appSchema, findCodeNames, footerLine, org, orgSchema } from "../src";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const text = JSON.stringify(org);

describe("the org JSON", () => {
  it("validates against its schema", () => {
    const validate = ajv.compile(orgSchema);
    expect(validate(org), JSON.stringify(validate.errors)).toBe(true);
  });

  it("says every product is in development (krizaka-com#468)", () => {
    expect(org.products.map((p) => [p.id, p.status])).toEqual([
      ["sovkora", "development"],
      ["verikora", "development"],
      ["folioviv", "development"],
    ]);
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

  it("publishes Krizaka's own social accounts (krizaka-internal#365)", () => {
    expect(org.links.social).toEqual([
      { id: "instagram", label: "Instagram", url: "https://www.instagram.com/krizakahq/" },
      { id: "youtube", label: "YouTube", url: "https://www.youtube.com/@krizakahq" },
    ]);
    const validate = ajv.compile(orgSchema);
    expect(validate({ ...org, links: { social: [{ id: "instagram", label: "Instagram", url: "http://x" }] } })).toBe(
      false,
    );
    expect(validate({ ...org, links: { social: [{ id: "instagram", label: "Instagram" }] } })).toBe(false);
  });

  it("lists only the live products", () => {
    expect(org.products.map((p) => p.id)).toEqual(["sovkora", "verikora", "folioviv"]);
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

describe("the family's status is honest", () => {
  const listed = (org.family ?? []).filter((e) => e.group === "products" || e.group === "open-source");

  it("every product and open-source entry shares one status (everything is in development, founder 2026-11-01)", () => {
    expect(new Set(listed.map((e) => e.status))).toEqual(new Set(["development"]));
  });

  it("a released entry carries the date of its release in data", () => {
    for (const e of listed.filter((x) => x.status === "released"))
      expect(e.releasedAt, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

  it("points every product at its own dev host, never a retired code-name host (krizaka-internal#2659)", () => {
    for (const [id, config] of Object.entries(apps)) expect(config.apiBaseUrl.dev).toBe(`https://dev.${id}.com`);
    expect(findCodeNames(JSON.stringify(apps))).toEqual([]);
  });

  it("holds no secret", () => {
    expect(JSON.stringify(apps)).not.toMatch(/secret|token|password|api[_-]?key|bearer|-----BEGIN/i);
  });

  it("refuses a field the schema does not know", () => {
    const validate = ajv.compile(appSchema);
    expect(validate({ ...apps.sovkora, apiKey: "x" })).toBe(false);
  });
});
