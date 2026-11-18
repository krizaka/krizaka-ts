/** A text in both languages. */
export interface Localized {
  fr: string;
  en: string;
}

/**
 * Where a product stands, the one closed set every site reads (krizaka-internal#3425). `design`: in conception, nothing built.
 * `upcoming`: announced. `construction`: being built, nothing offered. `development`: built in the open. `paused`: work paused
 * for now. `devPreview`: runs on its dev site for QA. Adding a value is compatible (schema 2 stays); a reader of the old two-value
 * set only breaks if the data uses a new one, so a new value ships with its readers.
 */
export const PRODUCT_STATUS = ["design", "upcoming", "construction", "development", "paused", "devPreview"] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

/**
 * The closed set of mascot birds, the same ids as `MascotBird` in @krizaka/ui (this package never imports what renders, ADR-004,
 * so the set is written here and a test pins it). The org JSON is the source of truth for which bird speaks for which product.
 */
export const MASCOT_BIRDS = [
  "falcon",
  "owl",
  "duck",
  "flamingo",
  "pigeon",
  "lovebird",
  "crane",
  "magpie",
  "beaver",
] as const;
export type MascotBird = (typeof MASCOT_BIRDS)[number];

export interface OrgProduct {
  id: string;
  name: string;
  status: ProductStatus;
  /** The product's own site. */
  url: string;
  /** Its public source repository. */
  repo: string;
  /** The product's own bird (krizaka-internal#3642): falcon is Krizaka's, never shared. */
  mascot: MascotBird;
}

/** What a site is: the company's own, a product's, a documentation site of a library, or the motion lab. */
export type SiteKind = "company" | "product" | "docs" | "lab";

/**
 * How a site wears its bird. `own`: its own palette, never the host's accent (the duck of Sovkora stays Sovkora's colour on
 * the Java site). `brand`: the host's accent.
 */
export type SiteTone = "own" | "brand";

export interface OrgSite {
  /** One id per site, the same in `family` and `footer.sites` (`krizaka`, `lab`). */
  id: string;
  name: string;
  url: string;
  kind: SiteKind;
  /** The site's identity bird. A product site carries its product's bird (`products[].mascot`); a docs site never reuses a product's or the falcon. */
  mascot: { bird: MascotBird; tone: SiteTone };
  /** The one-line description every kit and card reads, in both languages. */
  description: Localized;
  /**
   * The ids this site used to go by (`www`, `motion`), kept for one minor: deprecated in 1.8.0, removed in 1.9.0. Read the
   * site by its `id`.
   */
  aliases?: string[];
}

/** Where an entry of the family sits: the company's own pages, the products, the open-source libraries and tools, GitHub. */
export type FamilyGroup = "krizaka" | "products" | "open-source" | "github";

/** `released`: open to use. `development`: built in the open, said « In development ». */
export type FamilyStatus = "released" | "development";

/**
 * One name of the family, the only place it is written. The naming rule (founder, 2026-10-30): the company is
 * « Krizaka »; a product goes by its own name (« Verikora », never « Krizaka Verikora »); a library or a tool is always
 * « Krizaka <X> » (« Krizaka UI », never « UI » alone outside a group headed « Open source »).
 */
export interface FamilyEntry {
  id: string;
  /** The display name, never translated (« Krizaka TypeScript »). */
  name: string;
  /** The short name, only inside its group's heading (« TypeScript » under « Open source »). */
  short: string;
  group: FamilyGroup;
  status: FamilyStatus;
  /** The day it was released (`YYYY-MM-DD`): `released` on a product or an open-source entry needs it, data not words. */
  releasedAt?: string;
  /** Its home: the site, or the repository while it has no site. */
  url: string;
  /** Its public source repository (`null` for GitHub itself). */
  repo: string | null;
}

/** The member values the views filter on, named once (a view never compares a magic string). */
export const MEMBER = { product: "product", released: "released" } as const;

/** What a member of the family is (krizaka-internal#3913). */
export type MemberKind = "company" | "blog" | "product" | "library" | "lab" | "github";

/** One status set for everything the family shows: the product statuses, plus `released` and `retired`. */
export type MemberStatus = ProductStatus | "released" | "retired";

/**
 * One row of the family table (`family` in `@krizaka/org`, krizaka-internal#3913): the only place a member is written.
 * `products`, `sites`, `family` (the groups) and `brands` are filters of it.
 */
export interface FamilyMember {
  /** The one id, in every file, every site, every ticket label (`kridoc`, `rust`). */
  id: string;
  name: string;
  /** The short name, under the « Open source » heading. */
  short: string;
  kind: MemberKind;
  group: FamilyGroup;
  /** Position inside its group. */
  order: number;
  status: MemberStatus;
  /** Required when `status` is `released`. */
  releasedAt?: string;
  /** A private member is in no public view and never in `org.json`. */
  visibility: "public" | "private";
  urls: {
    /** The public home; `null` while none exists. */
    site: string | null;
    /** Set by the data: a site that does not answer is never linked. */
    siteLive: boolean;
    /** Its public source repository; `null` when private or none. */
    repo: string | null;
    dev?: string;
    app?: string;
    shop?: string;
  };
  /** The name of its site when it differs from `name` (`krizaka.com`). */
  siteName?: string;
  /** The ids its site used to go by. */
  aliases?: string[];
  /** The bird; required for a member whose site is live. */
  mascot?: { bird: MascotBird; tone: SiteTone };
  /** CDN paths without the version: `brand/<id>/mark-<theme>.svg`. */
  mark: { light: string; dark: string };
  words: { line: Localized };
}

export interface OrgAvatar {
  id: string;
  /** `person` is a silhouette, `plain` a plain disc. */
  kind: "person" | "plain";
  svg: string;
  webp256: string;
  webp512: string;
  alt: Localized;
}

export interface OrgBanner {
  id: string;
  /** 1536x512 WebP. */
  url: string;
  alt: Localized;
}

/** The kinds of entity that have a set of default pictures. */
export type OrgDefaultKind = "person" | "folder" | "organisation" | "shop" | "banner";

export interface OrgDefaultItem {
  /** Stable within its kind (`silhouette-3`, `boom-bap`). */
  id: string;
  /** What the picture shows, in both languages (never who). */
  alt: Localized;
  /** Withdrawn from the set: still listed in the JSON, and its files stay served (a versioned URL never changes), but `listDefaults` and `defaultFor` skip it. */
  disabled?: true;
  urls: {
    /** The vector, for the sets drawn from the code. */
    svg?: string;
    /** Size in px (a square's side, a banner's width) → URL. */
    webp: Record<string, string>;
  };
}

/** The central sets of default pictures: URLs an app uses by default, never its own copy. */
export interface OrgDefaults {
  /** The folder version on the CDN: a changed picture is a new version, the old URLs keep serving. */
  version: string;
  base: string;
  rule: { pick: "fnv1a32-modulo"; description: string };
  kinds: Record<OrgDefaultKind, OrgDefaultItem[]>;
}

export interface OrgMark {
  svg: string;
  png64: string;
  png256: string;
  png512: string;
  png1024: string;
}

/** The ids of the legal pages a footer may link. */
export type LegalId = "privacy" | "terms";

/** What one site's footer shows (krizaka-internal#3563): a selection out of the org data, never text of its own. */
export interface FooterSite {
  /** The family groups listed, in this order. */
  families: FamilyGroup[];
  /** The ids of `links.social` shown, in this order. */
  social: string[];
  /** The site's own source-code link; `null` shows none. */
  source: string | null;
  /** Whether the licence (`company.license`) shows. */
  license: boolean;
  /** The ids of `footer.legal` shown, in this order. */
  legal: LegalId[];
  /** Whether the version line of the site shows. */
  version: boolean;
}

/** A footer, resolved by `footerFor`: the entries, the socials and the legal links, ready to render. */
export interface ResolvedFooter {
  id: string;
  groups: { group: FamilyGroup; entries: FamilyEntry[] }[];
  social: OrgSocialLink[];
  source: string | null;
  license: string | null;
  legal: Org["footer"]["legal"];
  line: Localized;
  version: boolean;
}

export interface Org {
  $schema: string;
  /** The contract: `2` adds `defaults` (compatible: everything of `1` is unchanged). */
  schemaVersion: 2;
  /** The version of `@krizaka/org` that carries this data. */
  version: string;
  /** The day the facts were last reviewed (YYYY-MM-DD). */
  updatedAt: string;
  company: {
    legalName: string;
    tradeName: string;
    /** Numéro d'entreprise du Québec, already public in the legal footer. */
    neq: string;
    city: string;
    region: string;
    country: string;
    license: string;
    /** « Fait à Montréal ». */
    madeIn: Localized;
  };
  brand: {
    name: string;
    logo: { dark: OrgMark; light: OrgMark };
    mark: { dark: OrgMark; light: OrgMark };
    favicon: string;
    appleTouchIcon: string;
    socialPreview: string;
    manifest: string;
  };
  /** The company's own bird (the falcon). */
  mascot: MascotBird;
  people: {
    /** Legacy sets by brand (`people/defaults/v1/krizaka`): kept for the readers of schema 1; new code reads `defaults`. */
    defaults: OrgAvatar[];
    banners: OrgBanner[];
  };
  /** The central default pictures (people, folders, organisations, shops, banners): use these URLs, never a copy. */
  defaults: OrgDefaults;
  /** Only the products that are live. */
  products: OrgProduct[];
  sites: OrgSite[];
  /** Every name of the family, in reading order (group, then order inside it): the bar, the switcher and every footer read it. */
  family: FamilyEntry[];
  /** The public rows of the family table (`family` in the package): the one source the lists above are filters of. */
  members: FamilyMember[];
  contact: {
    page: Localized;
    /** The public support address; `null` while none is public. */
    email: string | null;
  };
  /** The company's own accounts elsewhere; a footer picks the ids it shows, the address is never typed in a site. */
  links: {
    social: OrgSocialLink[];
  };
  footer: {
    line: Localized;
    legal: { id: LegalId; label: Localized; url: Localized }[];
    /** What each site shows, keyed by site id (the 12 sites: `krizaka`, `blog`, `ui`, `java`, `ts`, `rust`, `lab`, `agents`, `sovkora`, `verikora`, `folioviv`, `kridoc`): a site reads it with `footerFor`. */
    sites: Record<string, FooterSite>;
  };
}

/** The part of an app's runtime config that depends on the environment. */
export type AppEnvironment = "dev" | "production";

/** One of Krizaka's social accounts (`id` is the platform, in lower case: `instagram`). */
export interface OrgSocialLink {
  id: string;
  label: string;
  url: string;
}

export interface AppConfig {
  $schema: string;
  schemaVersion: 1;
  /** The product this file configures. */
  app: string;
  /** The API's base URL per environment; `null` while that environment does not exist. */
  apiBaseUrl: Record<AppEnvironment, string | null>;
  /** Feature flags a client may know. */
  features: Record<string, boolean>;
  /** The oldest app version the backend still answers (semver). */
  minAppVersion: string;
  /** The org file's legal line, so a binary can show it without a network call. */
  updatedAt: string;
}
