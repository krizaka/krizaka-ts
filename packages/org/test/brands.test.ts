import { describe, expect, it } from "vitest";

import {
  brandOf,
  brands,
  catalogueValues,
  CODE_NAMES,
  codeNameMap,
  displayName,
  findCodeNames,
  lockup,
  org,
  visibleText,
} from "../src";

describe("the commercial names (krizaka-internal#2035)", () => {
  it("gives every product a commercial name, an endorsement and a site", () => {
    for (const product of org.products) {
      const brand = brandOf(product.id);
      expect(brand.commercialName, product.id).toMatch(/^[A-Z][a-z]+$/);
      expect(brand.domains.site, product.id).toMatch(/^https:\/\//);
      expect(brand.endorsement).toEqual({ en: "by Krizaka", fr: "par Krizaka" });
    }
  });

  it("carries the founder's decisions (krizaka-internal#2034, #2659)", () => {
    expect(brands.map((b) => b.id)).toEqual(["verikora", "folioviv", "sovkora", "kridoc"]);
    expect(brandOf("folioviv").domains).toEqual({
      site: "https://www.folioviv.com",
      app: "https://folioviv.app",
      shop: "https://folioviv.shop",
      dev: "https://dev.folioviv.com",
    });
    expect(brandOf("kridoc").kind).toBe("service");
    for (const b of brands) expect(b.id).toBe(b.commercialName.toLowerCase());
  });

  it("keeps the retired code names in one historic table, never as an alias", () => {
    expect(CODE_NAMES).toEqual({ yomizaka: "verikora", akinaza: "folioviv", orazaka: "sovkora", kachizaka: "kridoc" });
    expect(Object.isFrozen(CODE_NAMES)).toBe(true);
    expect(codeNameMap()).toEqual({
      yomizaka: "Verikora",
      akinaza: "Folioviv",
      orazaka: "Sovkora",
      kachizaka: "Kridoc",
    });
    expect(() => brandOf("yomizaka")).toThrow(/retired code name .*brandOf\("verikora"\)/);
    expect(() => brandOf("Orazaka")).toThrow(/brandOf\("sovkora"\)/);
  });

  it("refuses an unknown brand", () => {
    expect(() => brandOf("nope")).toThrow(/Unknown Krizaka brand/);
  });

  it("shows the administrator's name, else the commercial one, never a code name", () => {
    expect(displayName("verikora")).toBe("Verikora");
    expect(displayName("verikora", "  Verikora Pro ")).toBe("Verikora Pro");
    expect(displayName("verikora", "")).toBe("Verikora");
    expect(displayName("verikora", null)).toBe("Verikora");
    expect(displayName("verikora", "Yomizaka")).toBe("Verikora");
    expect(displayName("verikora", "le yomizaka pro")).toBe("Verikora");
    expect(displayName("verikora", "x".repeat(31))).toBe("Verikora");
  });

  it("writes the lockup in both languages", () => {
    expect(lockup("verikora", "en")).toBe("Verikora by Krizaka");
    expect(lockup("folioviv", "fr")).toBe("Folioviv par Krizaka");
    expect(lockup("sovkora", "fr", "Moteur maison")).toBe("Moteur maison par Krizaka");
  });
});

describe("the code-name guard (krizaka-internal#2036, #2659: none, anywhere)", () => {
  it("finds every retired code name, in any case and inside a word, with its replacement in the same case", () => {
    const hits = findCodeNames("Yomizaka, ORAZAKA_KEY, brand-akinaza, dev.kachizaka.com, createOrazakaClient");
    expect(hits.map((h) => [h.word, h.use])).toEqual([
      ["Yomizaka", "Verikora"],
      ["ORAZAKA", "SOVKORA"],
      ["akinaza", "folioviv"],
      ["kachizaka", "kridoc"],
      ["Orazaka", "Sovkora"],
    ]);
  });

  it("has no allowed span: URLs, hosts, coordinates, code spans and link targets are refused too", () => {
    for (const text of [
      "https://github.com/krizaka/orazaka",
      "dev.yomizaka.com",
      "@krizaka/orazaka-client",
      "com.krizaka.orazaka:core",
      "the `akinaza` service",
      "[repo](https://www.akinaza.com/x)",
      "Yomizaka is now Verikora",
    ]) {
      expect(findCodeNames(text), text).toHaveLength(1);
    }
  });

  it("passes the commercial names and refuses « Krizaka ECM »", () => {
    expect(findCodeNames("Verikora, Folioviv, Sovkora and Kridoc by Krizaka — dev.verikora.com")).toEqual([]);
    expect(findCodeNames("Stored in Krizaka ECM").map((h) => h.use)).toEqual(["Kridoc"]);
  });

  it("reads metadata and accessible names, not markup", () => {
    const html = `<meta property="og:title" content="Folioviv"><img alt="Akinaza mark" src="/a.svg"><div data-x="akinaza"></div>`;
    expect(findCodeNames(visibleText(html))).toHaveLength(1);
  });

  it("reads a catalogue's values with their paths", () => {
    const values = catalogueValues({ site: { verikora: { title: "Verikora", list: ["Akinaza"] } } });
    expect(values).toEqual([
      ["site.verikora.title", "Verikora"],
      ["site.verikora.list[0]", "Akinaza"],
    ]);
    expect(values.flatMap(([, v]) => findCodeNames(v))).toHaveLength(1);
  });
});

describe("the org JSON stays service discovery (founder, 2026-11-01)", () => {
  it("carries no commercial name, code name or brand data", () => {
    expect(Object.keys(org)).not.toContain("brands");
    expect(org.schemaVersion).toBe(2);
  });

  it("no renderer helper returns a code name", () => {
    for (const b of brands) {
      for (const chosen of [undefined, "", ...Object.keys(CODE_NAMES), "Orazaka Pro"]) {
        for (const locale of ["fr", "en"]) {
          expect(findCodeNames(displayName(b.id, chosen)), `${b.id}/${chosen}`).toEqual([]);
          expect(findCodeNames(lockup(b.id, locale, chosen)), `${b.id}/${locale}/${chosen}`).toEqual([]);
        }
      }
    }
  });

  it("strips tags and trims punctuation in linear time (CodeQL js/polynomial-redos)", () => {
    const t0 = Date.now();
    expect(visibleText(`${"<".repeat(100000)}x`)).toContain("x");
    expect(findCodeNames(`${"(".repeat(50000)}dev.yomizaka.com${")".repeat(50000)}`)).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(visibleText("<p>Verikora</p><br/>par <b>Krizaka</b>")).toContain("Verikora");
    expect(findCodeNames("« Yomizaka »").map((h) => h.use)).toEqual(["Verikora"]);
  });

  it("strips comments and code without backtracking on hostile input", () => {
    const hostile = `${"<!--".repeat(50000)} Verikora`;
    const t0 = Date.now();
    expect(visibleText(hostile)).toContain("Verikora".slice(0, 0));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(visibleText("<p>a</p><SCRIPT>verikora()</SCRIPT><code>folioviv</code><p>b</p>")).not.toMatch(
      /verikora|folioviv/,
    );
  });
});
