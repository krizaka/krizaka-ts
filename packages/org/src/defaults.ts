import type { Localized, OrgDefaultItem, OrgDefaultKind, OrgDefaults } from "./org.types";

/** The pull zone that serves the sets. Declared here, not imported from `org.ts`, so `org.ts` can build its section from this file. */
const BASE = "https://krizaka-assets.b-cdn.net/defaults/v1";

/** The kinds of entity that have a default set, in the order the JSON lists them. */
export const DEFAULT_KINDS = ["person", "folder", "organisation", "shop", "banner"] as const satisfies readonly OrgDefaultKind[];

/** The sizes (px) each kind is served in: squares for the pictures, widths for the banners (3:1). */
const SIZES: Record<OrgDefaultKind, readonly number[]> = { person: [256, 512, 1024], folder: [256, 512, 1024], organisation: [256, 512, 1024], shop: [256, 512, 1024], banner: [960, 1920] };

const item = (kind: OrgDefaultKind, id: string, alt: Localized, drawn: boolean): OrgDefaultItem => ({
  id,
  alt,
  urls: {
    ...(drawn ? { svg: `${BASE}/${kind}/${id}.svg` } : {}),
    webp: Object.fromEntries(SIZES[kind].map((size) => [String(size), `${BASE}/${kind}/${id}-${size}.webp`])),
  },
});

const tones = (kind: OrgDefaultKind, id: string, alt: (n: number) => Localized): OrgDefaultItem[] => Array.from({ length: 6 }, (_, i) => item(kind, `${id}-${i + 1}`, alt(i + 1), true));

/** The founder's illustrated people (`defaults/v1/person/<id>-<size>.webp`). Alt texts say what the picture shows, never who. */
const PEOPLE: [string, Localized][] = [
  ["boom-bap", { en: "Illustration: a rapper in a denim jacket and beanie, microphone in hand, in a rainy Montréal alley at night", fr: "Illustration : un rappeur en veste de jean et tuque, micro à la main, dans une ruelle de Montréal sous la pluie, la nuit" }],
  ["rasta-creative", { en: "A smiling man with long dreadlocks in a paint-stained denim jacket, in an artist's workshop", fr: "Un homme souriant aux longues dreadlocks, en veste de jean tachée de peinture, dans un atelier d'artiste" }],
  ["mile-end-hipster", { en: "A smiling person with round glasses and an orange beanie at a leatherworking bench, in a brick workshop", fr: "Une personne souriante à lunettes rondes et tuque orange, à son établi de cuir, dans un atelier de briques" }],
  ["tech-architect", { en: "A person in a dark hoodie typing at a keyboard, between screens of code and a server rack", fr: "Une personne en chandail à capuchon sombre qui tape au clavier, entre des écrans de code et une baie de serveurs" }],
  ["electronic-dj", { en: "A DJ with headphones behind synthesizers and a mixing desk, in a club with violet lights", fr: "Un DJ casque aux oreilles derrière des synthétiseurs et une table de mixage, dans un club aux lumières violettes" }],
  ["visual-artist", { en: "A smiling painter with violet hair and big glasses, palette in hand, in a studio full of canvases", fr: "Une peintre souriante aux cheveux violets et aux grosses lunettes, palette à la main, dans un atelier plein de toiles" }],
  ["salon-tattoo-maker", { en: "A tattoo artist with tattooed arms working on a client in a warm shop with wooden shelves", fr: "Une tatoueuse aux bras tatoués au travail sur un client, dans un salon chaleureux aux étagères de bois" }],
  ["wise-auditor", { en: "A grey-haired person with glasses at a desk of old books and a lamp, a pen over open notes", fr: "Une personne aux cheveux gris et à lunettes à un bureau de vieux livres et de lampe, un stylo sur des notes ouvertes" }],
  ["digital-creator", { en: "A laughing streamer with a microphone in a purple-lit studio under a neon « Creator Zone » sign", fr: "Une diffuseuse qui rit devant un micro, dans un studio violet sous une enseigne néon « Creator Zone »" }],
  ["studio-maker", { en: "A potter in a linen apron holding a clay bowl, in a bright ceramics studio with plants", fr: "Une potière en tablier de lin tenant un bol d'argile, dans un atelier de céramique lumineux et plein de plantes" }],
  ["community-lead", { en: "A smiling person with curly hair and a grey coat at a wooden table, a community space behind them", fr: "Une personne souriante aux cheveux bouclés et au manteau gris, à une table de bois, devant un espace communautaire" }],
  ["ai-builder", { en: "A thoughtful person with blue-tinted glasses at a desk, screens of a neural network and code behind", fr: "Une personne pensive aux lunettes teintées de bleu à son bureau, devant des écrans de réseau neuronal et de code" }],
];

/** The founder's banners, 3:1 (`defaults/v1/banner/<id>-<width>.webp`). */
const BANNERS: [string, Localized][] = [
  ["montreal-winter-night", { en: "Illustration: a snowy night in downtown Montréal, lit shop fronts and walkers", fr: "Illustration : une nuit de neige au centre-ville de Montréal, devantures éclairées et passants" }],
  ["industrial-heritage", { en: "Dark blue skyline of old brick buildings with lit orange windows under a full moon", fr: "Silhouette bleu nuit de vieux immeubles de briques aux fenêtres orangées, sous la pleine lune" }],
  ["creator-loft-studio", { en: "A dark loft desk with a plant, a code window and a mixing board", fr: "Un bureau de loft sombre avec une plante, une fenêtre de code et une table de mixage" }],
  ["abstract-digital-flow", { en: "Flowing teal, violet and orange lines linking glowing points on a dark background", fr: "Des lignes ondulantes turquoise, violettes et orange reliant des points lumineux sur fond sombre" }],
  ["paperwork-and-ink", { en: "Two dark document cards with colored stamps on a night-blue grid", fr: "Deux cartes de documents sombres tamponnées de couleur sur une grille bleu nuit" }],
  ["nightlife-music-visual", { en: "A large glowing vinyl record with a pink label beside a small level meter, in violet light", fr: "Un grand disque vinyle lumineux à l'étiquette rose près d'un petit indicateur de niveau, en lumière violette" }],
  ["the-mascot-flock", { en: "The Krizaka mascots — an owl, a beaver and a flamingo — standing on a shelf in the dark", fr: "Les mascottes de Krizaka — un hibou, un castor et un flamant — debout sur une étagère dans le noir" }],
  ["abstract-stripes", { en: "Diagonal teal, indigo, violet and orange stripes with a white star and « Montréal // 514 »", fr: "Des bandes diagonales turquoise, indigo, violettes et orange avec une étoile blanche et « Montréal // 514 »" }],
  ["open-source-horizon", { en: "A dark terminal window on a grid, a faint horizon behind", fr: "Une fenêtre de terminal sombre sur une grille, un horizon pâle derrière" }],
  ["cafe-maker-studio", { en: "A warm dark brown scene with a card reading « Fabriqué à Montréal »", fr: "Une scène brun foncé chaleureuse avec une carte « Fabriqué à Montréal »" }],
  ["the-neon-flamingo", { en: "A pink neon flamingo outline on black, with a violet halo", fr: "Le contour d'un flamant rose en néon sur fond noir, avec un halo violet" }],
  ["cooperative-network", { en: "Small linked glowing points over a dark hill at dusk", fr: "De petits points lumineux reliés au-dessus d'une colline sombre au crépuscule" }],
];

const GLYPH_ALT = {
  person: (n: number): Localized => ({ en: `Default profile picture: a silhouette, tone ${n}`, fr: `Photo de profil par défaut : une silhouette, teinte ${n}` }),
  folder: (n: number): Localized => ({ en: `Default folder picture: a folder, tone ${n}`, fr: `Image de dossier par défaut : un dossier, teinte ${n}` }),
  organisation: (n: number): Localized => ({ en: `Default organisation picture: a building, tone ${n}`, fr: `Image d'organisation par défaut : un immeuble, teinte ${n}` }),
  shop: (n: number): Localized => ({ en: `Default shop picture: a storefront, tone ${n}`, fr: `Image de boutique par défaut : une devanture, teinte ${n}` }),
};

/** The `defaults` section of the org JSON: the central sets on Bunny (`defaults/v1/<kind>/<id>-<size>.<ext>`), written by krizaka-ui `tools/export-defaults.mjs`. */
export const defaults: OrgDefaults = {
  version: "v1",
  base: BASE,
  rule: {
    pick: "fnv1a32-modulo",
    description: "defaultFor(kind, seed) = items[fnv1a32(String(seed)) mod items.length] of the kind's list, in the order of the JSON; the same seed always gives the same item, in every app.",
  },
  kinds: {
    person: [...tones("person", "silhouette", GLYPH_ALT.person), ...PEOPLE.map(([id, alt]) => item("person", id, alt, false))],
    folder: tones("folder", "folder", GLYPH_ALT.folder),
    organisation: tones("organisation", "organisation", GLYPH_ALT.organisation),
    shop: tones("shop", "shop", GLYPH_ALT.shop),
    banner: BANNERS.map(([id, alt]) => item("banner", id, alt, false)),
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

/** The items of a kind, in the order of the JSON. A source other than the bundled one is the JSON an app fetched. */
export function listDefaults(kind: OrgDefaultKind, source: OrgDefaults = defaults): readonly OrgDefaultItem[] {
  return source.kinds[kind] ?? [];
}

/** The item of a kind for a seed (an entity's id): deterministic, so a folder keeps its picture everywhere. `undefined` only when the kind's list is empty. */
export function defaultFor(kind: OrgDefaultKind, seed: string | number, source: OrgDefaults = defaults): OrgDefaultItem | undefined {
  const items = listDefaults(kind, source);
  return items.length === 0 ? undefined : items[seedHash(seed) % items.length];
}

/** The URL of an item at the smallest size that is at least `size` px (or the largest there is); `svg` when the item has a vector and `format` says so. */
export function defaultUrl(entry: OrgDefaultItem, size: number, format: "webp" | "svg" = "webp"): string {
  if (format === "svg" && entry.urls.svg) return entry.urls.svg;
  const sizes = Object.keys(entry.urls.webp).map(Number).sort((a, b) => a - b);
  const chosen = sizes.find((s) => s >= size) ?? sizes[sizes.length - 1];
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
