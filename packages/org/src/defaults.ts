import banners from "./default-banners.json" with { type: "json" };
import people from "./default-people.json" with { type: "json" };
import type { Localized, OrgDefaultItem, OrgDefaultKind, OrgDefaults } from "./org.types";

/** The pull zone that serves the sets. Declared here, not imported from `org.ts`, so `org.ts` can build its section from this file. */
const BASE = "https://krizaka-assets.b-cdn.net/defaults/v1";

/** The kinds of entity that have a default set, in the order the JSON lists them. */
export const DEFAULT_KINDS = [
  "person",
  "folder",
  "organisation",
  "shop",
  "banner",
] as const satisfies readonly OrgDefaultKind[];

/** The sizes (px) each kind is served in: squares for the pictures, widths for the banners (3:1). */
const SIZES: Record<OrgDefaultKind, readonly number[]> = {
  person: [256, 512, 1024],
  folder: [256, 512, 1024],
  organisation: [256, 512, 1024],
  shop: [256, 512, 1024],
  banner: [960, 1920],
};

/** Withdrawn pictures, `<kind>/<id>`: kept in the JSON and on the CDN, never picked. The neon flamingo carries the wordmark of a paused product. */
export const DISABLED_DEFAULTS: ReadonlySet<string> = new Set(["banner/the-neon-flamingo"]);

const item = (kind: OrgDefaultKind, id: string, alt: Localized, drawn: boolean): OrgDefaultItem => ({
  id,
  alt,
  ...(DISABLED_DEFAULTS.has(`${kind}/${id}`) ? { disabled: true as const } : {}),
  urls: {
    ...(drawn ? { svg: `${BASE}/${kind}/${id}.svg` } : {}),
    webp: Object.fromEntries(SIZES[kind].map((size) => [String(size), `${BASE}/${kind}/${id}-${size}.webp`])),
  },
});

const tones = (kind: OrgDefaultKind, id: string, alt: (n: number) => Localized): OrgDefaultItem[] =>
  Array.from({ length: 6 }, (_, i) => item(kind, `${id}-${i + 1}`, alt(i + 1), true));

/** The founder's illustrated people (`defaults/v1/person/<id>-<size>.webp`). Alt texts say what the picture shows, never who. */
const PEOPLE = people as readonly { id: string; alt: Localized }[];

/** The founder's banners, 3:1 (`defaults/v1/banner/<id>-<width>.webp`). */
const BANNERS = banners as readonly { id: string; alt: Localized }[];

const GLYPH_ALT = {
  person: (n: number): Localized => ({
    en: `Default profile picture: a silhouette, tone ${n}`,
    fr: `Photo de profil par défaut : une silhouette, teinte ${n}`,
  }),
  folder: (n: number): Localized => ({
    en: `Default folder picture: a folder, tone ${n}`,
    fr: `Image de dossier par défaut : un dossier, teinte ${n}`,
  }),
  organisation: (n: number): Localized => ({
    en: `Default organisation picture: a building, tone ${n}`,
    fr: `Image d'organisation par défaut : un immeuble, teinte ${n}`,
  }),
  shop: (n: number): Localized => ({
    en: `Default shop picture: a storefront, tone ${n}`,
    fr: `Image de boutique par défaut : une devanture, teinte ${n}`,
  }),
};

/** The `defaults` section of the org JSON: the central sets on Bunny (`defaults/v1/<kind>/<id>-<size>.<ext>`), written by krizaka-ui `tools/export-defaults.mjs`. */
export const defaults: OrgDefaults = {
  version: "v1",
  base: BASE,
  rule: {
    pick: "fnv1a32-modulo",
    description:
      "defaultFor(kind, seed) = items[fnv1a32(String(seed)) mod items.length] of the kind's list, in the order of the JSON; the same seed always gives the same item, in every app.",
  },
  kinds: {
    person: [
      ...tones("person", "silhouette", GLYPH_ALT.person),
      ...PEOPLE.map(({ id, alt }) => item("person", id, alt, false)),
    ],
    folder: tones("folder", "folder", GLYPH_ALT.folder),
    organisation: tones("organisation", "organisation", GLYPH_ALT.organisation),
    shop: tones("shop", "shop", GLYPH_ALT.shop),
    banner: BANNERS.map(({ id, alt }) => item("banner", id, alt, false)),
  },
};

// ---- reading -------------------------------------------------------------------------------------------------------

/** 32-bit FNV-1a of a seed: stable across runs, devices and products (the same one `@krizaka/ui`'s default avatars use). */
export function seedHash(seed: string | number): number {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The items of a kind that can be picked, in the order of the JSON (a withdrawn one is skipped). A source other than the bundled one is the JSON an app fetched. */
export function listDefaults(kind: OrgDefaultKind, source: OrgDefaults = defaults): readonly OrgDefaultItem[] {
  return (source.kinds[kind] ?? []).filter((entry) => entry.disabled !== true);
}

/** The item of a kind for a seed (an entity's id): deterministic, so a folder keeps its picture everywhere. `undefined` only when the kind's list is empty. */
export function defaultFor(
  kind: OrgDefaultKind,
  seed: string | number,
  source: OrgDefaults = defaults,
): OrgDefaultItem | undefined {
  const items = listDefaults(kind, source);
  return items.length === 0 ? undefined : items[seedHash(seed) % items.length];
}

/** The URL of an item at the smallest size that is at least `size` px (or the largest there is); `svg` when the item has a vector and `format` says so. */
export function defaultUrl(entry: OrgDefaultItem, size: number, format: "webp" | "svg" = "webp"): string {
  if (format === "svg" && entry.urls.svg) return entry.urls.svg;
  const sizes = Object.keys(entry.urls.webp)
    .map(Number)
    .sort((a, b) => a - b);
  const chosen = sizes.find((s) => s >= size) ?? sizes.at(-1);
  return entry.urls.webp[String(chosen)] ?? "";
}

/** Reads the section from the published JSON (`ORG_URL`), for an app that does not bundle this package. */
export async function fetchDefaults(url: string, fetchImpl: typeof fetch = fetch): Promise<OrgDefaults> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const json = (await res.json()) as { defaults?: OrgDefaults };
  if (!json.defaults) throw new Error(`${url} has no \`defaults\` section`);
  return json.defaults;
}
