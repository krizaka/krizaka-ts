import { defaultUrl, listDefaults } from "./defaults";
import type { OrgDefaultItem } from "./org.types";

/** The products that have a demo cast. */
export type CastProduct = "orazaka" | "yomizaka" | "akinaza";

/** What a persona does in the app: a member, a shop owner or a customer of one, an administrator. */
export type CastRole = "member" | "admin" | "owner" | "client";

/** One fictitious person of the demo cast. No e-mail domain and no password: those come from the environment, through the secrets map. */
export interface CastPersona {
  /** Stable key, unique in its product: `eric`, `camille`. Seeds, recordings and tests name the persona by it. */
  readonly id: string;
  readonly product: CastProduct;
  readonly firstName: string;
  /** The name every screen, demo and recording shows: never « qa » nor « admin ». */
  readonly displayName: string;
  readonly role: CastRole;
  readonly locale: "fr" | "en";
  /** Id of a `person` default of the org defaults JSON (`defaults/v1/person/<id>`). */
  readonly avatar: string;
  /** Id of a `banner` default, for the personas whose page has one. */
  readonly banner?: string;
  /** The demo workspace the persona belongs to (a key the app's seed knows: a set of folders, a shop). */
  readonly workspace: string;
}

/** The versioned cast. Change it here, then re-run each app's `seed --cast`: every environment gets the same people. */
// @fixed: a schema version of the cast, bumped by hand when its shape changes
export const CAST_VERSION = 1;

export const CAST: readonly CastPersona[] = [
  // The same three people as the deployed QA accounts (Eric, Mira, Camille) in each product, so a laptop and the dev deployment hold the same names.
  {
    id: "eric",
    product: "yomizaka",
    firstName: "Éric",
    displayName: "Éric Tremblay",
    role: "member",
    locale: "fr",
    avatar: "community-lead",
    workspace: "rosemont-villeray",
  },
  {
    id: "mira",
    product: "yomizaka",
    firstName: "Mira",
    displayName: "Mira Haddad",
    role: "admin",
    locale: "fr",
    avatar: "ai-builder",
    workspace: "administration",
  },
  {
    id: "camille",
    product: "yomizaka",
    firstName: "Camille",
    displayName: "Camille Tremblay",
    role: "member",
    locale: "fr",
    avatar: "visual-artist",
    workspace: "rosemont-villeray",
  },
  // Orazaka: the accounts already deployed on dev. Éric is the user (ORAZAKA_USER_*, APP_QA_ORAZAKA_PERSONA_*), Mira the administrator
  // (ORAZAKA_ADMIN_*, APP_QA_ORAZAKA_MIRA_*), Krizaka the company as an SME customer (APP_QA_ORAZAKA_KRIZAKA_*). The greeting reads the name: never « qa_user ».
  {
    id: "eric",
    product: "orazaka",
    firstName: "Éric",
    displayName: "Éric Tremblay",
    role: "member",
    locale: "fr",
    avatar: "community-lead",
    workspace: "demo",
  },
  {
    id: "mira",
    product: "orazaka",
    firstName: "Mira",
    displayName: "Mira Haddad",
    role: "admin",
    locale: "fr",
    avatar: "ai-builder",
    workspace: "administration",
  },
  {
    id: "krizaka",
    product: "orazaka",
    firstName: "Krizaka",
    displayName: "Krizaka",
    role: "member",
    locale: "fr",
    avatar: "tech-architect",
    workspace: "demo",
  },
  // Akinaza: Éric owns the Krizaka studio, Léa is the Saint-Henri walker, Camille is her first client, Mira administers.
  {
    id: "eric",
    product: "akinaza",
    firstName: "Éric",
    displayName: "Éric Tremblay",
    role: "owner",
    locale: "fr",
    avatar: "community-lead",
    banner: "creator-loft-studio",
    workspace: "krizaka-studio",
  },
  {
    id: "mira",
    product: "akinaza",
    firstName: "Mira",
    displayName: "Mira Haddad",
    role: "admin",
    locale: "fr",
    avatar: "ai-builder",
    workspace: "administration",
  },
  {
    id: "lea",
    product: "akinaza",
    firstName: "Léa",
    displayName: "Léa Beaulieu",
    role: "owner",
    locale: "fr",
    avatar: "studio-maker",
    banner: "cafe-maker-studio",
    workspace: "saint-henri",
  },
  {
    id: "camille",
    product: "akinaza",
    firstName: "Camille",
    displayName: "Camille Tremblay",
    role: "client",
    locale: "fr",
    avatar: "visual-artist",
    workspace: "saint-henri",
  },
  {
    id: "jordan",
    product: "akinaza",
    firstName: "Jordan",
    displayName: "Jordan Lee",
    role: "client",
    locale: "en",
    avatar: "tech-architect",
    workspace: "saint-henri",
  },
  {
    id: "nadia",
    product: "akinaza",
    firstName: "Nadia",
    displayName: "Nadia Benali",
    role: "client",
    locale: "fr",
    avatar: "digital-creator",
    workspace: "saint-henri",
  },
  {
    id: "etienne",
    product: "akinaza",
    firstName: "Étienne",
    displayName: "Étienne Gagnon",
    role: "client",
    locale: "fr",
    avatar: "boom-bap",
    workspace: "saint-henri",
  },
  {
    id: "sofia",
    product: "akinaza",
    firstName: "Sofia",
    displayName: "Sofia Rossi",
    role: "client",
    locale: "en",
    avatar: "salon-tattoo-maker",
    workspace: "saint-henri",
  },
];

/** The personas of a product, in cast order. */
export const castOf = (product: CastProduct): readonly CastPersona[] => CAST.filter((p) => p.product === product);

/** One persona by product and id; throws on an unknown one (a seed or a recording naming a person the cast lacks is a bug). */
export function persona(product: CastProduct, id: string): CastPersona {
  const found = CAST.find((p) => p.product === product && p.id === id);
  if (!found)
    throw new Error(
      `cast: no persona "${id}" in ${product} (known: ${castOf(product)
        .map((p) => p.id)
        .join(", ")})`,
    );
  return found;
}

/** The first persona of a role in a product (the member to sign in as, the administrator). */
export function personaByRole(product: CastProduct, role: CastRole): CastPersona {
  const found = castOf(product).find((p) => p.role === role);
  if (!found) throw new Error(`cast: no ${role} in ${product}`);
  return found;
}

const urlOf = (kind: "person" | "banner", id: string, size: number): string => {
  const entry: OrgDefaultItem | undefined = listDefaults(kind).find((d) => d.id === id);
  if (!entry) throw new Error(`cast: no ${kind} default "${id}" in the org defaults`);
  return defaultUrl(entry, size);
};

/** The avatar and banner URLs of a persona, from the org defaults (Bunny, versioned): never typed in an app. */
export function castMedia(p: CastPersona, size = 512): { avatar: string; banner?: string } {
  return { avatar: urlOf("person", p.avatar, size), ...(p.banner ? { banner: urlOf("banner", p.banner, 960) } : {}) };
}

/**
 * The fingerprint of what a seed must leave in a database: counts per table, in a stable order. The seed prints it and
 * a check after the deploy compares the local one with the dev one (same cast and same code give the same string).
 */
export function seedFingerprint(counts: Readonly<Record<string, number>>): string {
  return Object.keys(counts)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) // by code point, never by locale: the same string on every machine
    .map((table) => `${table}=${counts[table]}`)
    .join(";");
}
