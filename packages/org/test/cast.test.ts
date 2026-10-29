import { describe, expect, it } from "vitest";

import { CAST, castMedia, castOf, listDefaults, persona, personaByRole, seedFingerprint } from "../src";

describe("the demo cast", () => {
  it("has unique ids per product and a display name that is a person's", () => {
    const keys = CAST.map((p) => `${p.product}/${p.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of CAST) {
      expect(p.displayName.startsWith(p.firstName), p.id).toBe(true);
      expect(p.displayName, p.id).not.toMatch(/\b(qa|admin|test|user)\b/i);
    }
  });

  it("has Eric, Mira and Camille in every product, as the deployed QA accounts do", () => {
    for (const product of ["orazaka", "yomizaka", "akinaza"] as const) {
      expect(castOf(product).map((p) => p.id)).toEqual(
        expect.arrayContaining(product === "orazaka" ? ["eric", "mira", "krizaka"] : ["eric", "mira", "camille"]),
      );
      expect(persona(product, "mira").role).toBe("admin");
    }
  });

  it("holds no e-mail address and no secret", () => {
    expect(JSON.stringify(CAST)).not.toMatch(/@|password|secret/i);
  });

  it("points every avatar and banner at an org default that exists and is enabled", () => {
    const people = new Set(
      listDefaults("person")
        .filter((d) => !d.disabled)
        .map((d) => d.id),
    );
    const banners = new Set(
      listDefaults("banner")
        .filter((d) => !d.disabled)
        .map((d) => d.id),
    );
    for (const p of CAST) {
      expect(people.has(p.avatar), `${p.id} avatar`).toBe(true);
      if (p.banner) expect(banners.has(p.banner), `${p.id} banner`).toBe(true);
    }
  });

  it("gives each product a member or owner and an administrator", () => {
    expect(personaByRole("yomizaka", "member").id).toBe("eric");
    expect(personaByRole("yomizaka", "admin").displayName).toBe("Mira Haddad");
    expect(castOf("akinaza").filter((p) => p.role === "client")).toHaveLength(5);
    expect(() => persona("yomizaka", "nobody")).toThrow(/known: eric, mira, camille/);
  });

  it("resolves media from the defaults, on the CDN", () => {
    expect(castMedia(persona("akinaza", "lea")).banner).toMatch(/\/defaults\/v1\/banner\/cafe-maker-studio-960\.webp$/);
    expect(castMedia(persona("yomizaka", "eric")).avatar).toMatch(/person\/community-lead-512\.webp$/);
  });

  it("fingerprints counts in a stable order", () => {
    expect(seedFingerprint({ b: 2, a: 1 })).toBe("a=1;b=2");
  });
});
