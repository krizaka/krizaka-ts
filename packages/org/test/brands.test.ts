import { describe, expect, it } from "vitest";

import {
  brandOf,
  brands,
  catalogueValues,
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

  it("carries the founder's decisions (krizaka-internal#2034)", () => {
    expect(codeNameMap()).toEqual({
      yomizaka: "Verikora",
      akinaza: "Folioviv",
      orazaka: "Sovkora",
      kachizaka: "Kridoc",
    });
    expect(brandOf("akinaza").domains).toEqual({
      site: "https://www.folioviv.com",
      app: "https://folioviv.app",
      shop: "https://folioviv.shop",
      dev: "https://dev.folioviv.com",
    });
    expect(brandOf("kachizaka").kind).toBe("service");
    expect(brandOf("kachizaka").formerly).toBeNull();
    expect(brandOf("yomizaka").formerly?.fr).toBe("Yomizaka s’appelle désormais Verikora");
  });

  it("refuses an unknown code name", () => {
    expect(() => brandOf("nope")).toThrow(/Unknown Krizaka code name/);
  });

  it("shows the administrator's name, else the commercial one, never a code name", () => {
    expect(displayName("yomizaka")).toBe("Verikora");
    expect(displayName("yomizaka", "  Verikora Pro ")).toBe("Verikora Pro");
    expect(displayName("yomizaka", "")).toBe("Verikora");
    expect(displayName("yomizaka", null)).toBe("Verikora");
    expect(displayName("yomizaka", "Yomizaka")).toBe("Verikora");
    expect(displayName("yomizaka", "x".repeat(31))).toBe("Verikora");
  });

  it("writes the lockup in both languages", () => {
    expect(lockup("yomizaka", "en")).toBe("Verikora by Krizaka");
    expect(lockup("akinaza", "fr")).toBe("Folioviv par Krizaka");
    expect(lockup("orazaka", "fr", "Moteur maison")).toBe("Moteur maison par Krizaka");
  });
});

describe("the code-name guard (krizaka-internal#2036)", () => {
  it("fails a page that names a product by its code name", () => {
    const html = `<html><head><title>Yomizaka — read before you sign</title></head><body><h1>Yomizaka</h1></body></html>`;
    const hits = findCodeNames(visibleText(html));
    expect(hits.map((h) => [h.word, h.use])).toEqual([
      ["Yomizaka", "Verikora"],
      ["Yomizaka", "Verikora"],
    ]);
  });

  it("passes « Verikora by Krizaka » with a GitHub link, a class, a package and a command", () => {
    const html = `<body class="brand-yomizaka"><h1>Verikora by Krizaka</h1>
      <a href="https://github.com/krizaka/yomizaka">Source: https://github.com/krizaka/yomizaka</a>
      <p>Install <code>orazaka run</code>, package @krizaka/orazaka-client, repo krizaka/akinaza, com.krizaka.orazaka:core.</p>
      <pre>npm i @krizaka/orazaka-client</pre><script>const x = "akinaza"</script></body>`;
    expect(findCodeNames(visibleText(html))).toEqual([]);
  });

  it("allows the one « formerly » line and old hosts, refuses « Krizaka ECM »", () => {
    expect(findCodeNames("Yomizaka is now Verikora. Old links on dev.yomizaka.com keep working.")).toEqual([]);
    expect(findCodeNames("Akinaza s’appelle désormais Folioviv")).toEqual([]);
    expect(findCodeNames("Stored in Krizaka ECM").map((h) => h.use)).toEqual(["Kridoc"]);
    expect(findCodeNames("the `kachizaka` service")).toEqual([]);
    expect(findCodeNames("Powered by Orazaka").map((h) => h.use)).toEqual(["Sovkora"]);
  });

  it("reads metadata and accessible names, not markup", () => {
    const html = `<meta property="og:title" content="Akinaza"><img alt="Akinaza mark" src="/a.svg"><div data-x="akinaza"></div>`;
    expect(findCodeNames(visibleText(html))).toHaveLength(2);
  });

  it("reads a catalogue's values, never its keys", () => {
    const values = catalogueValues({ site: { yomizaka: { title: "Verikora", list: ["Akinaza"] } } });
    expect(values).toEqual([
      ["site.yomizaka.title", "Verikora"],
      ["site.yomizaka.list[0]", "Akinaza"],
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
      for (const chosen of [undefined, "", b.codeName, `${b.codeName} Pro`]) {
        for (const locale of ["fr", "en"]) {
          expect(findCodeNames(displayName(b.codeName, chosen)), `${b.codeName}/${chosen}`).toEqual([]);
          expect(findCodeNames(lockup(b.codeName, locale, chosen)), `${b.codeName}/${locale}/${chosen}`).toEqual([]);
        }
      }
    }
  });

  it("strips comments and code without backtracking on hostile input", () => {
    const hostile = `${"<!--".repeat(50000)} Verikora`;
    const t0 = Date.now();
    expect(visibleText(hostile)).toContain("Verikora".slice(0, 0));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(visibleText("<p>a</p><SCRIPT>yomizaka()</SCRIPT><code>akinaza</code><p>b</p>")).not.toMatch(
      /yomizaka|akinaza/,
    );
  });
});
