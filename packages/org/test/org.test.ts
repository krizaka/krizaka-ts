import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  apps,
  appSchema,
  brandOf,
  findCodeNames,
  footerLine,
  MASCOT_BIRDS,
  org,
  orgSchema,
  PRODUCT_STATUS,
} from "../src";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const text = JSON.stringify(org);

describe("the org JSON", () => {
  it("validates against its schema", () => {
    const validate = ajv.compile(orgSchema);
    expect(validate(org), JSON.stringify(validate.errors)).toBe(true);
  });

  it("carries each product's bird and the org's own, from the closed set (krizaka-internal#3642)", () => {
    expect(org.mascot).toBe("falcon");
    expect(Object.fromEntries(org.products.map((p) => [p.id, p.mascot]))).toEqual({
      sovkora: "duck",
      verikora: "owl",
      folioviv: "beaver",
      kridoc: "crane",
    });
    for (const bird of [org.mascot, ...org.products.map((p) => p.mascot)]) expect(MASCOT_BIRDS).toContain(bird);
    const birds = [org.mascot, ...org.products.map((p) => p.mascot)];
    expect(new Set(birds).size).toBe(birds.length);
  });

  it("exposes the birds in the JSON a reader fetches, and the schema refuses a bird outside the set", () => {
    const json = JSON.parse(text) as typeof org;
    expect(json.mascot).toBe("falcon");
    expect(json.products.every((p) => MASCOT_BIRDS.includes(p.mascot))).toBe(true);
    const validate = ajv.compile(orgSchema);
    expect(validate({ ...json, products: [{ ...json.products[0], mascot: "dodo" }] })).toBe(false);
    expect(validate({ ...json, mascot: undefined })).toBe(false);
  });

  it("gives every site a kind, a bird in its own tone and a description (krizaka-internal#3785)", () => {
    expect(Object.fromEntries(org.sites.map((s) => [s.id, s.mascot.bird]))).toEqual({
      krizaka: "falcon",
      blog: "falcon",
      ui: "magpie",
      java: "pigeon",
      ts: "lovebird",
      lab: "flamingo",
      sovkora: "duck",
      verikora: "owl",
      folioviv: "beaver",
      kridoc: "crane",
    });
    for (const s of org.sites) {
      expect(s.mascot.tone, s.id).toBe("own");
      expect(s.description.fr.length, s.id).toBeGreaterThan(0);
      expect(s.description.en.length, s.id).toBeGreaterThan(0);
    }
    expect(org.sites.filter((s) => s.kind === "product").map((s) => s.id)).toEqual(org.products.map((p) => p.id));
  });

  it("points each product site at its product: same bird, same url", () => {
    for (const p of org.products) {
      const site = org.sites.find((s) => s.id === p.id);
      expect(site?.kind, p.id).toBe("product");
      expect(site?.mascot.bird, p.id).toBe(p.mascot);
      expect(site?.url, p.id).toBe(p.url);
    }
  });

  it("refuses a docs site that reuses a product's bird or the falcon", () => {
    const reserved = new Set([org.mascot, ...org.products.map((p) => p.mascot)]);
    const docs = org.sites.filter((s) => s.kind === "docs" || s.kind === "lab");
    expect(docs.map((s) => s.id).sort()).toEqual(["java", "lab", "ts", "ui"]);
    for (const s of docs) expect(reserved.has(s.mascot.bird), s.id).toBe(false);
    expect(new Set(docs.map((s) => s.mascot.bird)).size).toBe(docs.length);
  });

  it("uses one id per site across sites, family and footer.sites; old ids are aliases only", () => {
    const ids = org.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // rust has no bird yet and agents is private: both resolve a footer without being in `sites`.
    for (const id of Object.keys(org.footer.sites))
      if (!["rust", "agents"].includes(id)) expect(ids, `footer.sites.${id}`).toContain(id);
    for (const e of org.family.filter((f) => f.group !== "github" && f.id !== "rust"))
      expect(ids, `family.${e.id}`).toContain(e.id);
    const aliases = org.sites.flatMap((s) => (s.aliases ?? []).map((a) => [a, s.id]));
    expect(Object.fromEntries(aliases)).toEqual({ www: "krizaka", motion: "lab" });
    for (const [alias] of aliases) expect(ids).not.toContain(alias);
  });

  it("says where Java's artefacts are without naming Maven Central, and gives Kridoc its line", () => {
    const java = org.sites.find((s) => s.id === "java");
    for (const site of org.sites) expect(`${site.description.fr} ${site.description.en}`, site.id).not.toMatch(/maven central|crates\.io/i);
    expect(java?.description.en).toMatch(/GitHub/);
    expect(org.sites.find((s) => s.id === "kridoc")?.description.en.length).toBeGreaterThan(0);
  });

  it("the schema refuses a site without a bird, or with a tone outside the set", () => {
    const json = JSON.parse(text) as typeof org;
    const validate = ajv.compile(orgSchema);
    const [first, ...rest] = json.sites;
    expect(validate({ ...json, sites: [{ ...first, mascot: undefined }, ...rest] })).toBe(false);
    expect(validate({ ...json, sites: [{ ...first, mascot: { bird: "falcon", tone: "pink" } }, ...rest] })).toBe(false);
    expect(validate({ ...json, sites: [{ ...first, kind: "shop" }, ...rest] })).toBe(false);
  });

  it("says every product is in development (krizaka-com#468)", () => {
    expect(org.products.map((p) => [p.id, p.status])).toEqual([
      ["sovkora", "development"],
      ["verikora", "development"],
      ["folioviv", "development"],
      ["kridoc", "development"],
    ]);
  });

  it("has one closed set of product statuses, the schema and the data agree (krizaka-internal#3425)", () => {
    expect(PRODUCT_STATUS).toEqual(["design", "upcoming", "construction", "development", "paused", "devPreview"]);
    const validate = ajv.compile(orgSchema);
    for (const status of PRODUCT_STATUS) {
      const products = org.products.map((p, i) => (i === 0 ? { ...p, status } : p));
      expect(validate({ ...org, products }), status).toBe(true);
    }
  });

  it("refuses a product status outside the set", () => {
    const validate = ajv.compile(orgSchema);
    for (const status of ["live", "Paused", "released", ""]) {
      const products = org.products.map((p, i) => (i === 0 ? { ...p, status } : p));
      expect(validate({ ...org, products }), status).toBe(false);
    }
  });

  it("still parses for a reader of schema 2: every status the data carries was in the old set", () => {
    const old = new Set(["development", "devPreview"]);
    for (const p of org.products) expect(old.has(p.status), p.id).toBe(true);
    expect(org.schemaVersion).toBe(2);
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

  it("publishes Krizaka's own social accounts (krizaka-internal#365, krizaka-internal#3141)", () => {
    expect(org.links.social).toEqual([
      { id: "instagram", label: "Instagram", url: "https://www.instagram.com/krizakahq/" },
      { id: "facebook", label: "Facebook", url: "https://www.facebook.com/1482481631608218" },
      { id: "youtube", label: "YouTube", url: "https://www.youtube.com/@krizakahq" },
      { id: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/company/krizaka-technologies-inc" },
    ]);
    // LinkedIn uses HTTPS
    const linkedin = org.links.social.find((l) => l.id === "linkedin");
    expect(linkedin?.url).toMatch(/^https:/);
    // all ids are unique
    const ids = org.links.social.map((l) => l.id);
    expect(ids).toEqual([...new Set(ids)]);
    const validate = ajv.compile(orgSchema);
    expect(validate({ ...org, links: { social: [{ id: "instagram", label: "Instagram", url: "http://x" }] } })).toBe(
      false,
    );
    expect(validate({ ...org, links: { social: [{ id: "instagram", label: "Instagram" }] } })).toBe(false);
  });

  it("lists Kridoc in development at its own site, with its public repository (krizaka-internal#3561)", () => {
    expect(org.products.find((p) => p.id === "kridoc")).toEqual({
      id: "kridoc",
      name: "Kridoc",
      status: "development",
      url: "https://www.kridoc.com",
      repo: "https://github.com/krizaka/kridoc",
      mascot: "crane",
    });
  });

  it("lists only the live products", () => {
    expect(org.products.map((p) => p.id)).toEqual(["sovkora", "verikora", "folioviv", "kridoc"]);
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
    // Kridoc has no app of its own and no dev host: it has no runtime config.
    expect(Object.keys(apps)).toEqual(org.products.filter((p) => brandOf(p.id).domains.dev !== null).map((p) => p.id));
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
