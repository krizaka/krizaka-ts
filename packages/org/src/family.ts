import type { FamilyMember, Localized, MascotBird } from "./org.types";

/**
 * The family table (krizaka-internal#3913, slice 1 of #3910): one row per member of the Krizaka family, the only place a
 * name, a status, a host, a bird or a one-line description is written. `products`, `sites`, `family` (the groups), `brands`
 * and `org.members` are computed from it, never typed again. A private member (`visibility: "private"`) is in this table
 * but in no public view and never in `org.json`.
 */

const GITHUB = "https://github.com/krizaka";
const gh = (repo: string) => `${GITHUB}/${repo}`;

type Kind = FamilyMember["kind"];
type Group = FamilyMember["group"];

/** One row per member: id, name, short, kind, group, site, repository (a repo name under github.com/krizaka), bird. */
type Row = [string, string, string, Kind, Group, string | null, string | null, MascotBird | null];

const ROWS: Row[] = [
  ["krizaka", "Krizaka", "Krizaka", "company", "krizaka", "https://www.krizaka.com", "krizaka-com", "falcon"],
  ["blog", "Blog", "Blog", "blog", "krizaka", "https://blog.krizaka.com", "krizaka-blog", "falcon"],
  ["sovkora", "Sovkora", "Sovkora", "product", "products", "https://www.sovkora.com", "sovkora", "duck"],
  ["verikora", "Verikora", "Verikora", "product", "products", "https://www.verikora.com", "verikora", "owl"],
  ["folioviv", "Folioviv", "Folioviv", "product", "products", "https://www.folioviv.com", "folioviv", "beaver"],
  // Kridoc is the managed storage (krizaka-internal#1916); a product like the others (CTO, #3913).
  ["kridoc", "Kridoc", "Kridoc", "product", "products", "https://www.kridoc.com", "kridoc", "crane"],
  // Private until its site answers (krizaka-internal#3394): no public view, no link to its repository.
  ["agents", "Krizaka Agents", "Agents", "product", "products", "https://agents.krizaka.com", null, null],
  ["ui", "Krizaka UI", "UI", "library", "open-source", "https://ui.krizaka.com", "krizaka-ui", "magpie"],
  ["java", "Krizaka Java", "Java", "library", "open-source", "https://java.krizaka.com", "krizaka-java", "pigeon"],
  [
    "ts",
    "Krizaka TypeScript",
    "TypeScript",
    "library",
    "open-source",
    "https://ts.krizaka.com",
    "krizaka-ts",
    "lovebird",
  ],
  ["lab", "Krizaka Lab", "Lab", "lab", "open-source", "https://lab.krizaka.com", "krizaka-lab", "flamingo"],
  // rust.krizaka.com answers (krizaka-internal#4114): the site is the link, the repository stays the source link. No bird yet.
  ["rust", "Krizaka Rust", "Rust", "library", "open-source", "https://rust.krizaka.com", "krizaka-rust", null],
  ["github", "GitHub", "GitHub", "github", "github", GITHUB, null, null],
];

/** What only some members have: the other hosts, the old ids, a status other than development, a private row. */
type Extra = Partial<Omit<FamilyMember, "urls">> & { urls?: Partial<FamilyMember["urls"]> };
const EXTRA: Record<string, Extra> = {
  krizaka: { status: "released", siteName: "krizaka.com", aliases: ["www"] },
  blog: { status: "released" },
  github: { status: "released" },
  sovkora: { urls: { dev: "https://dev.sovkora.com" } },
  verikora: { urls: { dev: "https://dev.verikora.com" } },
  folioviv: { urls: { dev: "https://dev.folioviv.com", app: "https://folioviv.app", shop: "https://folioviv.shop" } },
  agents: { visibility: "private", urls: { siteLive: false } },
  lab: { aliases: ["motion"] },
};

/** The one line of each member, in both languages. */
const WORDS: Record<string, Localized> = {
  krizaka: {
    fr: "Technologies Krizaka : des logiciels pour les entreprises d'ici, construits à la vue de tous.",
    en: "Technologies Krizaka: software for local businesses, built in the open.",
  },
  blog: {
    fr: "Le blogue de Krizaka : ce que nous construisons et ce que nous en apprenons.",
    en: "The Krizaka blog: what we build and what we learn from it.",
  },
  sovkora: {
    fr: "Sovkora : des vidéos et des médias produits par l'IA, du scénario au rendu.",
    en: "Sovkora: AI-made video and media, from script to render.",
  },
  verikora: {
    fr: "Verikora : lire un document et en vérifier les faits, les chiffres et les données personnelles.",
    en: "Verikora: read a document and check its facts, figures and personal data.",
  },
  folioviv: {
    fr: "Folioviv : réservations, vitrine et heures d'ouverture des commerces locaux.",
    en: "Folioviv: bookings, storefront and opening hours for local businesses.",
  },
  kridoc: {
    fr: "Kridoc : vos documents, classés et retrouvables, au même endroit.",
    en: "Kridoc: your documents, filed and findable, in one place.",
  },
  agents: {
    fr: "Krizaka Agents : l'équipe d'agents qui construit les produits.",
    en: "Krizaka Agents: the team of agents that builds the products.",
  },
  ui: {
    fr: "Composants React, variables de design et blocs de pages partagés par chaque produit Krizaka.",
    en: "React components, design variables and page blocks shared by every Krizaka product.",
  },
  java: {
    fr: "Briques Spring Boot des services Krizaka. Pas encore de registre public : le code et les versions sont sur GitHub.",
    en: "Spring Boot building blocks for Krizaka services. No public registry yet: the source and the releases are on GitHub.",
  },
  ts: {
    fr: "Briques TypeScript pour le serveur et le client, publiées sur npm sous @krizaka/.",
    en: "TypeScript building blocks for server and client, published on npm under @krizaka/.",
  },
  lab: {
    fr: "Le laboratoire du mouvement : des essais de 3D et d'animation, montrés avant d'entrer dans les produits.",
    en: "The motion lab: 3D and animation experiments, shown before they reach the products.",
  },
  rust: {
    fr: "Briques Rust des applications de bureau Krizaka : les règles dans un crate pur, la colle Tauri à part.",
    en: "Rust building blocks for the Krizaka desktop apps: the rules in a pure crate, the Tauri glue apart.",
  },
  github: {
    fr: "Le code de Krizaka, sur GitHub.",
    en: "Krizaka's code, on GitHub.",
  },
};

export const family: readonly FamilyMember[] = ROWS.map(([id, name, short, kind, group, site, repo, bird], index) => {
  const { urls: more, ...extra } = EXTRA[id] ?? {};
  return {
    id,
    name,
    short,
    kind,
    group,
    order: ROWS.slice(0, index).filter((r) => r[4] === group).length + 1,
    status: "development",
    visibility: "public",
    urls: { site, siteLive: site !== null, repo: repo ? gh(repo) : null, ...more },
    ...(bird ? { mascot: { bird, tone: "own" } } : {}),
    mark: { light: `brand/${id}/mark-light.svg`, dark: `brand/${id}/mark-dark.svg` },
    words: { line: WORDS[id] as Localized },
    ...extra,
  };
});
