import pkg from "../package.json" with { type: "json" };
import { defaults as centralDefaults } from "./defaults";
import type { FooterSite, Localized, MascotBird, Org, OrgAvatar, OrgMark, OrgSite } from "./org.types";

/** The pull zone that serves the brand files and this JSON. */
export const CDN = "https://krizaka-assets.b-cdn.net";
export const ORG_URL = `${CDN}/org/v1/org.json`;
export const ORG_SCHEMA_URL = `${CDN}/org/v1/org.schema.json`;

const cdn = (path: string) => `${CDN}/${path}`;

const mark = (kind: "logo" | "mark", theme: "dark" | "light"): OrgMark => ({
  svg: cdn(`brand/krizaka/${kind}-${theme}.svg`),
  png64: cdn(`brand/krizaka/${kind}-${theme}-64.png`),
  png256: cdn(`brand/krizaka/${kind}-${theme}-256.png`),
  png512: cdn(`brand/krizaka/${kind}-${theme}-512.png`),
  png1024: cdn(`brand/krizaka/${kind}-${theme}-1024.png`),
});

const TONES = [1, 2, 3, 4, 5, 6] as const;

const avatarAlt = (kind: "person" | "plain", n: number): Localized =>
  kind === "person"
    ? {
        fr: `Photo de profil par défaut : silhouette, teinte ${n}`,
        en: `Default profile picture: silhouette, tone ${n}`,
      }
    : {
        fr: `Photo de profil par défaut : disque uni, teinte ${n}`,
        en: `Default profile picture: plain disc, tone ${n}`,
      };

/** The default profile pictures a product shows when a person has no photo (`people/defaults/v1`, krizaka-ui `tools/export-brand.mjs`). */
const defaults: OrgAvatar[] = (["person", "plain"] as const).flatMap((kind) =>
  TONES.map((n) => ({
    id: `${kind}-${n}`,
    kind,
    svg: cdn(`people/defaults/v1/krizaka/${kind}-${n}.svg`),
    webp256: cdn(`people/defaults/v1/krizaka/${kind}-${n}-256.webp`),
    webp512: cdn(`people/defaults/v1/krizaka/${kind}-${n}-512.webp`),
    alt: avatarAlt(kind, n),
  })),
);

/** The public facts about Krizaka. Reviewed by pull request; changing a fact is one PR here and a release. */
type FamilyEntry = NonNullable<Org["family"]>[number];
type FamilyRow = [
  FamilyEntry["id"],
  string,
  string,
  FamilyEntry["group"],
  FamilyEntry["status"],
  string,
  string | null,
];

const GITHUB = "https://github.com/krizaka";
const gh = (repo: string) => `${GITHUB}/${repo}`;

/** The family list as data: one row per entry (id, name, short, group, status, url, repo). */
const FAMILY_ROWS: FamilyRow[] = [
  ["krizaka", "Krizaka", "Krizaka", "krizaka", "released", "https://www.krizaka.com", gh("krizaka-com")],
  ["blog", "Blog", "Blog", "krizaka", "released", "https://blog.krizaka.com", gh("krizaka-blog")],
  ["sovkora", "Sovkora", "Sovkora", "products", "development", "https://www.sovkora.com", gh("sovkora")],
  ["verikora", "Verikora", "Verikora", "products", "development", "https://www.verikora.com", gh("verikora")],
  ["folioviv", "Folioviv", "Folioviv", "products", "development", "https://www.folioviv.com", gh("folioviv")],
  ["kridoc", "Kridoc", "Kridoc", "products", "development", "https://www.kridoc.com", gh("kridoc")],
  ["ui", "Krizaka UI", "UI", "open-source", "development", "https://ui.krizaka.com", gh("krizaka-ui")],
  ["java", "Krizaka Java", "Java", "open-source", "development", "https://java.krizaka.com", gh("krizaka-java")],
  ["ts", "Krizaka TypeScript", "TypeScript", "open-source", "development", "https://ts.krizaka.com", gh("krizaka-ts")],
  ["lab", "Krizaka Lab", "Lab", "open-source", "development", "https://lab.krizaka.com", gh("krizaka-lab")],
  ["github", "GitHub", "GitHub", "github", "released", GITHUB, null],
];

const family: FamilyEntry[] = FAMILY_ROWS.map(([id, name, short, group, status, url, repo]) => ({
  id,
  name,
  short,
  group,
  status,
  url,
  repo,
}));

/**
 * Every public site, one id each (krizaka-internal#3785). A product site points at its product: same bird, same url (a test pins it).
 * Every bird is `own`: it wears its own palette, never the host accent.
 */
type SiteRow = [OrgSite["id"], string, string, OrgSite["kind"], MascotBird, string, string, string?];

/** The sites as data: id, name, url, kind, bird, French line, English line, the old id kept as an alias. */
const SITE_ROWS: SiteRow[] = [
  [
    "krizaka",
    "krizaka.com",
    "https://www.krizaka.com",
    "company",
    "falcon",
    "Technologies Krizaka : des logiciels pour les entreprises d'ici, construits à la vue de tous.",
    "Technologies Krizaka: software for local businesses, built in the open.",
    "www",
  ],
  [
    "blog",
    "Blog",
    "https://blog.krizaka.com",
    "company",
    "falcon",
    "Le blogue de Krizaka : ce que nous construisons et ce que nous en apprenons.",
    "The Krizaka blog: what we build and what we learn from it.",
  ],
  [
    "ui",
    "Krizaka UI",
    "https://ui.krizaka.com",
    "docs",
    "magpie",
    "Composants React, variables de design et blocs de pages partagés par chaque produit Krizaka.",
    "React components, design variables and page blocks shared by every Krizaka product.",
  ],
  [
    "java",
    "Krizaka Java",
    "https://java.krizaka.com",
    "docs",
    "pigeon",
    "Briques Spring Boot des services Krizaka. Pas encore de registre public : le code et les versions sont sur GitHub.",
    "Spring Boot building blocks for Krizaka services. No public registry yet: the source and the releases are on GitHub.",
  ],
  [
    "ts",
    "Krizaka TypeScript",
    "https://ts.krizaka.com",
    "docs",
    "lovebird",
    "Briques TypeScript pour le serveur et le client, publiées sur npm sous @krizaka/.",
    "TypeScript building blocks for server and client, published on npm under @krizaka/.",
  ],
  [
    "lab",
    "Krizaka Lab",
    "https://lab.krizaka.com",
    "lab",
    "flamingo",
    "Le laboratoire du mouvement : des essais de 3D et d'animation, montrés avant d'entrer dans les produits.",
    "The motion lab: 3D and animation experiments, shown before they reach the products.",
    "motion",
  ],
  [
    "sovkora",
    "Sovkora",
    "https://www.sovkora.com",
    "product",
    "duck",
    "Sovkora : des vidéos et des médias produits par l'IA, du scénario au rendu.",
    "Sovkora: AI-made video and media, from script to render.",
  ],
  [
    "verikora",
    "Verikora",
    "https://www.verikora.com",
    "product",
    "owl",
    "Verikora : lire un document et en vérifier les faits, les chiffres et les données personnelles.",
    "Verikora: read a document and check its facts, figures and personal data.",
  ],
  [
    "folioviv",
    "Folioviv",
    "https://www.folioviv.com",
    "product",
    "beaver",
    "Folioviv : réservations, vitrine et heures d'ouverture des commerces locaux.",
    "Folioviv: bookings, storefront and opening hours for local businesses.",
  ],
  [
    "kridoc",
    "Kridoc",
    "https://www.kridoc.com",
    "product",
    "crane",
    "Kridoc : vos documents, classés et retrouvables, au même endroit.",
    "Kridoc: your documents, filed and findable, in one place.",
  ],
];

const SITES: OrgSite[] = SITE_ROWS.map(([id, name, url, kind, bird, fr, en, alias]) => ({
  id,
  name,
  url,
  kind,
  mascot: { bird, tone: "own" },
  description: { fr, en },
  ...(alias ? { aliases: [alias] } : {}),
}));

const SOCIAL = ["instagram", "youtube", "linkedin"];

/** The shared selection of the developer sites: the whole family, every social account, the source, the licence, both legal links and the version line (founder target, krizaka-internal#754). */
const developerFooter = (source: string | null): FooterSite => ({
  families: ["krizaka", "products", "open-source", "github"],
  social: SOCIAL,
  source,
  license: true,
  legal: ["privacy", "terms"],
  version: true,
});

export const org: Org = {
  $schema: ORG_SCHEMA_URL,
  schemaVersion: 2,
  version: pkg.version,
  updatedAt: "2026-11-08",
  company: {
    legalName: "Technologies Krizaka Inc.",
    tradeName: "Krizaka",
    neq: "1182652231",
    city: "Montréal",
    region: "Québec",
    country: "CA",
    license: "Apache-2.0",
    madeIn: { fr: "Fait à Montréal", en: "Made in Montréal" },
  },
  brand: {
    name: "Krizaka",
    logo: { dark: mark("logo", "dark"), light: mark("logo", "light") },
    mark: { dark: mark("mark", "dark"), light: mark("mark", "light") },
    favicon: cdn("brand/krizaka/favicon.svg"),
    appleTouchIcon: cdn("brand/krizaka/apple-touch-icon.png"),
    socialPreview: cdn("brand/krizaka/social-preview-1280x640.png"),
    manifest: cdn("brand/manifest.json"),
  },
  mascot: "falcon",
  people: {
    defaults,
    // No banner is published on the CDN yet; the set joins here with its alts when it is.
    banners: [],
  },
  defaults: centralDefaults,
  products: [
    {
      id: "sovkora",
      name: "Sovkora",
      status: "development",
      url: "https://www.sovkora.com",
      repo: "https://github.com/krizaka/sovkora",
      mascot: "duck",
    },
    {
      id: "verikora",
      name: "Verikora",
      status: "development",
      url: "https://www.verikora.com",
      repo: "https://github.com/krizaka/verikora",
      mascot: "owl",
    },
    {
      id: "folioviv",
      name: "Folioviv",
      status: "development",
      url: "https://www.folioviv.com",
      repo: "https://github.com/krizaka/folioviv",
      mascot: "beaver",
    },
    {
      id: "kridoc",
      name: "Kridoc",
      status: "development",
      url: "https://www.kridoc.com",
      repo: "https://github.com/krizaka/kridoc",
      mascot: "crane",
    },
  ],
  sites: SITES,
  family,
  contact: {
    page: { fr: "https://www.krizaka.com/fr/contact", en: "https://www.krizaka.com/en/contact" },
    email: null,
  },
  links: {
    social: [
      { id: "instagram", label: "Instagram", url: "https://www.instagram.com/krizakahq/" },
      { id: "youtube", label: "YouTube", url: "https://www.youtube.com/@krizakahq" },
      { id: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/company/krizaka-technologies-inc" },
    ],
  },
  footer: {
    line: {
      fr: "Une entreprise de Technologies Krizaka · Fait à Montréal",
      en: "A Technologies Krizaka company · Made in Montréal",
    },
    legal: [
      {
        id: "privacy",
        label: { fr: "Confidentialité", en: "Privacy" },
        url: { fr: "https://www.krizaka.com/fr/privacy", en: "https://www.krizaka.com/en/privacy" },
      },
      {
        id: "terms",
        label: { fr: "Conditions", en: "Terms" },
        url: { fr: "https://www.krizaka.com/fr/terms", en: "https://www.krizaka.com/en/terms" },
      },
    ],
    sites: {
      krizaka: { ...developerFooter(null), license: false, version: false },
      ui: developerFooter(gh("krizaka-ui")),
      lab: developerFooter(gh("krizaka-lab")),
      // Java is no longer published on Maven Central (founder, 2026-11-14): the source link only.
      java: developerFooter(gh("krizaka-java")),
      ts: developerFooter(gh("krizaka-ts")),
    },
  },
};
