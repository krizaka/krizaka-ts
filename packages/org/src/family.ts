import type { FamilyMember, Localized, MascotBird } from "./org.types";

/**
 * The family table (krizaka-internal#3913, slice 1 of #3910): one row per member of the Krizaka family, the only place a
 * name, a status, a host, a bird or a one-line description is written. `products`, `sites`, `family` (the groups), `brands`
 * and `org.members` are computed from it, never typed again. A private member (`visibility: "private"`) is in this table
 * but in no public view and never in `org.json`.
 */

const GITHUB = "https://github.com/krizaka";
const gh = (repo: string) => `${GITHUB}/${repo}`;
const mark = (id: string) => ({ light: `brand/${id}/mark-light.svg`, dark: `brand/${id}/mark-dark.svg` });
const own = (bird: MascotBird) => ({ bird, tone: "own" as const });
const line = (fr: string, en: string): Localized => ({ fr, en });

type Urls = FamilyMember["urls"];
const urls = (site: string | null, repo: string | null, more: Partial<Urls> = {}): Urls => ({
  site,
  siteLive: site !== null,
  repo,
  ...more,
});

export const family: readonly FamilyMember[] = [
  {
    id: "krizaka",
    name: "Krizaka",
    short: "Krizaka",
    kind: "company",
    group: "krizaka",
    order: 1,
    status: "released",
    visibility: "public",
    urls: urls("https://www.krizaka.com", gh("krizaka-com")),
    siteName: "krizaka.com",
    aliases: ["www"],
    mascot: own("falcon"),
    mark: mark("krizaka"),
    words: {
      line: line(
        "Technologies Krizaka : des logiciels pour les entreprises d'ici, construits à la vue de tous.",
        "Technologies Krizaka: software for local businesses, built in the open.",
      ),
    },
  },
  {
    id: "blog",
    name: "Blog",
    short: "Blog",
    kind: "blog",
    group: "krizaka",
    order: 2,
    status: "released",
    visibility: "public",
    urls: urls("https://blog.krizaka.com", gh("krizaka-blog")),
    mascot: own("falcon"),
    mark: mark("krizaka"),
    words: {
      line: line(
        "Le blogue de Krizaka : ce que nous construisons et ce que nous en apprenons.",
        "The Krizaka blog: what we build and what we learn from it.",
      ),
    },
  },
  {
    id: "sovkora",
    name: "Sovkora",
    short: "Sovkora",
    kind: "product",
    group: "products",
    order: 1,
    status: "development",
    visibility: "public",
    urls: urls("https://www.sovkora.com", gh("sovkora"), { dev: "https://dev.sovkora.com" }),
    mascot: own("duck"),
    mark: mark("sovkora"),
    words: {
      line: line(
        "Sovkora : des vidéos et des médias produits par l'IA, du scénario au rendu.",
        "Sovkora: AI-made video and media, from script to render.",
      ),
    },
  },
  {
    id: "verikora",
    name: "Verikora",
    short: "Verikora",
    kind: "product",
    group: "products",
    order: 2,
    status: "development",
    visibility: "public",
    urls: urls("https://www.verikora.com", gh("verikora"), { dev: "https://dev.verikora.com" }),
    mascot: own("owl"),
    mark: mark("verikora"),
    words: {
      line: line(
        "Verikora : lire un document et en vérifier les faits, les chiffres et les données personnelles.",
        "Verikora: read a document and check its facts, figures and personal data.",
      ),
    },
  },
  {
    id: "folioviv",
    name: "Folioviv",
    short: "Folioviv",
    kind: "product",
    group: "products",
    order: 3,
    status: "development",
    visibility: "public",
    urls: urls("https://www.folioviv.com", gh("folioviv"), {
      dev: "https://dev.folioviv.com",
      app: "https://folioviv.app",
      shop: "https://folioviv.shop",
    }),
    mascot: own("beaver"),
    mark: mark("folioviv"),
    words: {
      line: line(
        "Folioviv : réservations, vitrine et heures d'ouverture des commerces locaux.",
        "Folioviv: bookings, storefront and opening hours for local businesses.",
      ),
    },
  },
  {
    // Kridoc is the managed storage (krizaka-internal#1916); a product like the others (CTO, #3913).
    id: "kridoc",
    name: "Kridoc",
    short: "Kridoc",
    kind: "product",
    group: "products",
    order: 4,
    status: "development",
    visibility: "public",
    urls: urls("https://www.kridoc.com", gh("kridoc")),
    mascot: own("crane"),
    mark: mark("kridoc"),
    words: {
      line: line(
        "Kridoc : vos documents, classés et retrouvables, au même endroit.",
        "Kridoc: your documents, filed and findable, in one place.",
      ),
    },
  },
  {
    // Private until its site answers (krizaka-internal#3394): no public view, no link to its repository.
    id: "agents",
    name: "Krizaka Agents",
    short: "Agents",
    kind: "product",
    group: "products",
    order: 5,
    status: "development",
    visibility: "private",
    urls: { site: "https://agents.krizaka.com", siteLive: false, repo: null },
    mark: mark("agents"),
    words: {
      line: line(
        "Krizaka Agents : l'équipe d'agents qui construit les produits.",
        "Krizaka Agents: the team of agents that builds the products.",
      ),
    },
  },
  {
    id: "ui",
    name: "Krizaka UI",
    short: "UI",
    kind: "library",
    group: "open-source",
    order: 1,
    status: "development",
    visibility: "public",
    urls: urls("https://ui.krizaka.com", gh("krizaka-ui")),
    mascot: own("magpie"),
    mark: mark("ui"),
    words: {
      line: line(
        "Composants React, variables de design et blocs de pages partagés par chaque produit Krizaka.",
        "React components, design variables and page blocks shared by every Krizaka product.",
      ),
    },
  },
  {
    id: "java",
    name: "Krizaka Java",
    short: "Java",
    kind: "library",
    group: "open-source",
    order: 2,
    status: "development",
    visibility: "public",
    urls: urls("https://java.krizaka.com", gh("krizaka-java")),
    mascot: own("pigeon"),
    mark: mark("java"),
    words: {
      line: line(
        "Briques Spring Boot des services Krizaka. Pas encore de registre public : le code et les versions sont sur GitHub.",
        "Spring Boot building blocks for Krizaka services. No public registry yet: the source and the releases are on GitHub.",
      ),
    },
  },
  {
    id: "ts",
    name: "Krizaka TypeScript",
    short: "TypeScript",
    kind: "library",
    group: "open-source",
    order: 3,
    status: "development",
    visibility: "public",
    urls: urls("https://ts.krizaka.com", gh("krizaka-ts")),
    mascot: own("lovebird"),
    mark: mark("ts"),
    words: {
      line: line(
        "Briques TypeScript pour le serveur et le client, publiées sur npm sous @krizaka/.",
        "TypeScript building blocks for server and client, published on npm under @krizaka/.",
      ),
    },
  },
  {
    id: "lab",
    name: "Krizaka Lab",
    short: "Lab",
    kind: "lab",
    group: "open-source",
    order: 4,
    status: "development",
    visibility: "public",
    urls: urls("https://lab.krizaka.com", gh("krizaka-lab")),
    aliases: ["motion"],
    mascot: own("flamingo"),
    mark: mark("lab"),
    words: {
      line: line(
        "Le laboratoire du mouvement : des essais de 3D et d'animation, montrés avant d'entrer dans les produits.",
        "The motion lab: 3D and animation experiments, shown before they reach the products.",
      ),
    },
  },
  {
    // No site answers yet (rust.krizaka.com): its public repository is the link. No bird yet either.
    id: "rust",
    name: "Krizaka Rust",
    short: "Rust",
    kind: "library",
    group: "open-source",
    order: 5,
    status: "development",
    visibility: "public",
    urls: urls(null, gh("krizaka-rust")),
    mark: mark("rust"),
    words: {
      line: line(
        "Briques Rust des applications de bureau Krizaka : les règles dans un crate pur, la colle Tauri à part.",
        "Rust building blocks for the Krizaka desktop apps: the rules in a pure crate, the Tauri glue apart.",
      ),
    },
  },
  {
    id: "github",
    name: "GitHub",
    short: "GitHub",
    kind: "github",
    group: "github",
    order: 1,
    status: "released",
    visibility: "public",
    urls: urls(GITHUB, null),
    mark: mark("github"),
    words: { line: line("Le code de Krizaka, sur GitHub.", "Krizaka's code, on GitHub.") },
  },
];
