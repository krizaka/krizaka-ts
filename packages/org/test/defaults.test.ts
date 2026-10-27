import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { DEFAULT_KINDS, defaultFor, defaults, defaultUrl, fetchDefaults, listDefaults, org, orgSchema, seedHash } from "../src";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const section = JSON.stringify(defaults);

describe("the defaults section", () => {
  it("validates against the schema, and the whole file still does", () => {
    const validate = ajv.compile(orgSchema);
    expect(validate(org), JSON.stringify(validate.errors)).toBe(true);
    expect(org.schemaVersion).toBe(2);
  });

  it("stays readable by schema 1: the legacy people lists are untouched", () => {
    expect(org.people.defaults).toHaveLength(12);
    const validate = ajv.compile(orgSchema);
    const { defaults: _removed, ...v1 } = org;
    expect(validate({ ...v1, schemaVersion: 1 })).toBe(false); // `defaults` is required from 2
    expect(validate({ ...org, schemaVersion: 1 })).toBe(true);
  });

  it("refuses a field it does not list, in an item or beside the kinds", () => {
    const validate = ajv.compile(orgSchema);
    const bad = structuredClone(org);
    (bad.defaults.kinds.person[0] as unknown as Record<string, unknown>).owner = "x";
    expect(validate(bad)).toBe(false);
    const extra = structuredClone(org);
    (extra.defaults.kinds as unknown as Record<string, unknown>).avatar = [];
    expect(validate(extra)).toBe(false);
  });

  it("has the five kinds, each filled, with unique ids and an alt in both languages", () => {
    expect(DEFAULT_KINDS).toEqual(["person", "folder", "organisation", "shop", "banner"]);
    for (const kind of DEFAULT_KINDS) {
      const items = listDefaults(kind);
      expect(items.length, kind).toBeGreaterThanOrEqual(6);
      expect(new Set(items.map((i) => i.id)).size, kind).toBe(items.length);
      for (const i of items) {
        expect(i.alt.en).not.toBe(i.alt.fr);
        expect(i.alt.en.length).toBeGreaterThan(10);
      }
    }
    expect(listDefaults("person")).toHaveLength(18);
    // twelve banners in the JSON, the neon flamingo withdrawn (it carries the wordmark of a paused product): eleven can be picked
    expect(defaults.kinds.banner).toHaveLength(12);
    expect(listDefaults("banner")).toHaveLength(11);
  });

  it("names every URL <base>/<kind>/<id>-<size>.<ext> under the versioned prefix", () => {
    for (const kind of DEFAULT_KINDS) {
      for (const i of listDefaults(kind)) {
        for (const [size, url] of Object.entries(i.urls.webp)) expect(url).toBe(`${defaults.base}/${kind}/${i.id}-${size}.webp`);
        if (i.urls.svg) expect(i.urls.svg).toBe(`${defaults.base}/${kind}/${i.id}.svg`);
      }
    }
    expect(defaults.base).toBe("https://krizaka-assets.b-cdn.net/defaults/v1");
  });

  it("never lists a person's picture under a folder, an organisation or a shop", () => {
    const people = new Set(listDefaults("person").map((i) => i.id));
    for (const kind of ["folder", "organisation", "shop"] as const) {
      for (const i of listDefaults(kind)) {
        expect(people.has(i.id)).toBe(false);
        expect(i.id.startsWith(`${kind}-`)).toBe(true);
        expect(i.urls.webp["256"]).toContain(`/${kind}/`);
      }
    }
  });
});

describe("defaultFor", () => {
  it("is deterministic: the same seed gives the same item, every time", () => {
    for (const kind of DEFAULT_KINDS) expect(defaultFor(kind, "entity-42")).toBe(defaultFor(kind, "entity-42"));
    expect(defaultFor("folder", 7)).toBe(defaultFor("folder", "7"));
    expect(seedHash("a")).toBe(0xe40c292c); // FNV-1a 32 of "a": the same value in every app
  });

  it("spreads seeds over the whole list of a kind", () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => defaultFor("folder", `f-${i}`)?.id));
    expect(seen.size).toBe(6);
  });

  it("always answers from its own kind, so a folder never gets a person", () => {
    const people = new Set(listDefaults("person").map((i) => i.id));
    for (let i = 0; i < 200; i++) expect(people.has(defaultFor("folder", `folder-${i}`)!.id)).toBe(false);
  });

  it("answers undefined only for an empty list, and reads the JSON an app fetched", () => {
    const empty = { ...defaults, kinds: { ...defaults.kinds, shop: [] } };
    expect(defaultFor("shop", "x", empty)).toBeUndefined();
    expect(listDefaults("shop", empty)).toEqual([]);
  });

  it("picks the smallest size that is large enough", () => {
    const i = defaultFor("person", "u")!;
    expect(defaultUrl(i, 200)).toContain("-256.webp");
    expect(defaultUrl(i, 300)).toContain("-512.webp");
    expect(defaultUrl(i, 9999)).toContain("-1024.webp");
    expect(defaultUrl(defaultFor("folder", "u")!, 64, "svg")).toMatch(/\.svg$/);
  });

  it("fetches the section from the published JSON, and says when it is missing", async () => {
    const ok = () => Promise.resolve(new Response(JSON.stringify({ defaults })));
    expect(await fetchDefaults("https://x/org.json", ok as typeof fetch)).toEqual(defaults);
    await expect(fetchDefaults("https://x/org.json", (() => Promise.resolve(new Response("{}"))) as typeof fetch)).rejects.toThrow(/no `defaults`/);
    await expect(fetchDefaults("https://x/org.json", (() => Promise.resolve(new Response("", { status: 503 }))) as typeof fetch)).rejects.toThrow(/503/);
  });
});

describe("the section holds nothing private", () => {
  it("never carries the NEQ, an identifier of the company or any private field", () => {
    expect(section).not.toContain(org.company.neq);
    expect(section).not.toMatch(/\d{10}/); // no 10-digit number: not an NEQ, not a phone number
    expect(section).not.toMatch(/neq|numéro d'entreprise|business number|legalName|manifest/i);
    expect(section).not.toMatch(/secret|token|password|api[_-]?key|bearer|-----BEGIN/i);
  });

  it("holds only ids, alts and https URLs on the CDN under the versioned prefix", () => {
    const urls = section.match(/https?:\/\/[^"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(150);
    for (const url of urls) expect(url.startsWith("https://krizaka-assets.b-cdn.net/defaults/v1")).toBe(true);
    for (const key of section.match(/"[A-Za-z]+":/g) ?? []) expect(["version", "base", "rule", "pick", "description", "kinds", "person", "folder", "organisation", "shop", "banner", "id", "alt", "en", "fr", "urls", "svg", "webp", "disabled"].map((k) => `"${k}":`)).toContain(key);
  });
});

describe("withdrawn pictures", () => {
  it("keeps the neon flamingo in the JSON and its files served, but never picks it", () => {
    const flamingo = defaults.kinds.banner.find((b) => b.id === "the-neon-flamingo");
    expect(flamingo).toMatchObject({ disabled: true });
    expect(flamingo?.urls.webp["1920"]).toBe("https://krizaka-assets.b-cdn.net/defaults/v1/banner/the-neon-flamingo-1920.webp");
    expect(listDefaults("banner").some((b) => b.id === "the-neon-flamingo")).toBe(false);
    for (let seed = 0; seed < 500; seed++) expect(defaultFor("banner", seed)?.id).not.toBe("the-neon-flamingo");
  });
  it("offers no default that names a paused product (Orochia, Kachizaka, Yasakia, Yororis): in its id or its alt text", () => {
    const paused = /orochia|kachizaka|yasakia|yazakia|yororis/i;
    for (const kind of DEFAULT_KINDS) for (const entry of listDefaults(kind)) expect(`${entry.id} ${entry.alt.en} ${entry.alt.fr}`, `${kind}/${entry.id}`).not.toMatch(paused);
  });
});
