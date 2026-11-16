import type { FamilyMember, MascotBird } from "./org.types";

/**
 * The family table (krizaka-internal#3913, slice 1 of #3910): one row per member of the Krizaka family, the only place a
 * name, a status, a host, a bird or a one-line description is written. `products`, `sites`, `family` (the groups), `brands`
 * and `org.members` are computed from it, never typed again. A private member (`visibility: "private"`) is in this table
 * but in no public view and never in `org.json`.
 */

const GITHUB = "https://github.com/krizaka";
const gh = (repo: string) => `${GITHUB}/${repo}`;

type Urls = FamilyMember["urls"];
/** A member's addresses: its site answers when it has one. */
const urls = (site: string | null, repo: string | null, more: Partial<Urls> = {}): Urls => ({
  site,
  siteLive: site !== null,
  repo,
  ...more,
});

/** What differs between members; the rest is the default (public, in development, its own bird, the mark of its id). */
type Row = Pick<FamilyMember, "id" | "name" | "short" | "kind" | "group" | "urls"> &
  Partial<Pick<FamilyMember, "status" | "visibility" | "siteName" | "aliases">> & {
    bird?: MascotBird;
    fr: string;
    en: string;
  };

const placed: Record<string, number> = {};
const member = ({ bird, fr, en, ...row }: Row): FamilyMember => {
  const order = (placed[row.group] = (placed[row.group] ?? 0) + 1);
  return {
    status: "development",
    visibility: "public",
    ...row,
    order,
    ...(bird ? { mascot: { bird, tone: "own" } } : {}),
    mark: { light: `brand/${row.id}/mark-light.svg`, dark: `brand/${row.id}/mark-dark.svg` },
    words: { line: { fr, en } },
  };
};

export const family: readonly FamilyMember[] = [
  member({
    id: "krizaka",
    name: "Krizaka",
    short: "Krizaka",
    kind: "company",
    group: "krizaka",
    status: "released",
    urls: urls("https://www.krizaka.com", gh("krizaka-com")),
    siteName: "krizaka.com",
    aliases: ["www"],
    bird: "falcon",
    fr: "Technologies Krizaka : des logiciels pour les entreprises d'ici, construits à la vue de tous.",
    en: "Technologies Krizaka: software for local businesses, built in the open.",
  }),
  member({
    id: "blog",
    name: "Blog",
    short: "Blog",
    kind: "blog",
    group: "krizaka",
    status: "released",
    urls: urls("https://blog.krizaka.com", gh("krizaka-blog")),
    bird: "falcon",
    fr: "Le blogue de Krizaka : ce que nous construisons et ce que nous en apprenons.",
    en: "The Krizaka blog: what we build and what we learn from it.",
  }),
  member({
    id: "sovkora",
    name: "Sovkora",
    short: "Sovkora",
    kind: "product",
    group: "products",
    urls: urls("https://www.sovkora.com", gh("sovkora"), { dev: "https://dev.sovkora.com" }),
    bird: "duck",
    fr: "Sovkora : des vidéos et des médias produits par l'IA, du scénario au rendu.",
    en: "Sovkora: AI-made video and media, from script to render.",
  }),
  member({
    id: "verikora",
    name: "Verikora",
    short: "Verikora",
    kind: "product",
    group: "products",
    urls: urls("https://www.verikora.com", gh("verikora"), { dev: "https://dev.verikora.com" }),
    bird: "owl",
    fr: "Verikora : lire un document et en vérifier les faits, les chiffres et les données personnelles.",
    en: "Verikora: read a document and check its facts, figures and personal data.",
  }),
  member({
    id: "folioviv",
    name: "Folioviv",
    short: "Folioviv",
    kind: "product",
    group: "products",
    urls: urls("https://www.folioviv.com", gh("folioviv"), {
      dev: "https://dev.folioviv.com",
      app: "https://folioviv.app",
      shop: "https://folioviv.shop",
    }),
    bird: "beaver",
    fr: "Folioviv : réservations, vitrine et heures d'ouverture des commerces locaux.",
    en: "Folioviv: bookings, storefront and opening hours for local businesses.",
  }),
  // Kridoc is the managed storage (krizaka-internal#1916); a product like the others (CTO, #3913).
  member({
    id: "kridoc",
    name: "Kridoc",
    short: "Kridoc",
    kind: "product",
    group: "products",
    urls: urls("https://www.kridoc.com", gh("kridoc")),
    bird: "crane",
    fr: "Kridoc : vos documents, classés et retrouvables, au même endroit.",
    en: "Kridoc: your documents, filed and findable, in one place.",
  }),
  // Private until its site answers (krizaka-internal#3394): no public view, no link to its repository.
  member({
    id: "agents",
    name: "Krizaka Agents",
    short: "Agents",
    kind: "product",
    group: "products",
    visibility: "private",
    urls: { site: "https://agents.krizaka.com", siteLive: false, repo: null },
    fr: "Krizaka Agents : l'équipe d'agents qui construit les produits.",
    en: "Krizaka Agents: the team of agents that builds the products.",
  }),
  member({
    id: "ui",
    name: "Krizaka UI",
    short: "UI",
    kind: "library",
    group: "open-source",
    urls: urls("https://ui.krizaka.com", gh("krizaka-ui")),
    bird: "magpie",
    fr: "Composants React, variables de design et blocs de pages partagés par chaque produit Krizaka.",
    en: "React components, design variables and page blocks shared by every Krizaka product.",
  }),
  member({
    id: "java",
    name: "Krizaka Java",
    short: "Java",
    kind: "library",
    group: "open-source",
    urls: urls("https://java.krizaka.com", gh("krizaka-java")),
    bird: "pigeon",
    fr: "Briques Spring Boot des services Krizaka. Pas encore de registre public : le code et les versions sont sur GitHub.",
    en: "Spring Boot building blocks for Krizaka services. No public registry yet: the source and the releases are on GitHub.",
  }),
  member({
    id: "ts",
    name: "Krizaka TypeScript",
    short: "TypeScript",
    kind: "library",
    group: "open-source",
    urls: urls("https://ts.krizaka.com", gh("krizaka-ts")),
    bird: "lovebird",
    fr: "Briques TypeScript pour le serveur et le client, publiées sur npm sous @krizaka/.",
    en: "TypeScript building blocks for server and client, published on npm under @krizaka/.",
  }),
  member({
    id: "lab",
    name: "Krizaka Lab",
    short: "Lab",
    kind: "lab",
    group: "open-source",
    urls: urls("https://lab.krizaka.com", gh("krizaka-lab")),
    aliases: ["motion"],
    bird: "flamingo",
    fr: "Le laboratoire du mouvement : des essais de 3D et d'animation, montrés avant d'entrer dans les produits.",
    en: "The motion lab: 3D and animation experiments, shown before they reach the products.",
  }),
  // No site answers yet (rust.krizaka.com): its public repository is the link. No bird yet either.
  member({
    id: "rust",
    name: "Krizaka Rust",
    short: "Rust",
    kind: "library",
    group: "open-source",
    urls: urls(null, gh("krizaka-rust")),
    fr: "Briques Rust des applications de bureau Krizaka : les règles dans un crate pur, la colle Tauri à part.",
    en: "Rust building blocks for the Krizaka desktop apps: the rules in a pure crate, the Tauri glue apart.",
  }),
  member({
    id: "github",
    name: "GitHub",
    short: "GitHub",
    kind: "github",
    group: "github",
    status: "released",
    urls: urls(GITHUB, null),
    fr: "Le code de Krizaka, sur GitHub.",
    en: "Krizaka's code, on GitHub.",
  }),
];
