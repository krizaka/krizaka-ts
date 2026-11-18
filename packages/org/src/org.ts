import pkg from "../package.json" with { type: "json" };
import { defaults as centralDefaults } from "./defaults";
import { family as familyTable } from "./family";
import type {
  FamilyGroup,
  FooterSite,
  Localized,
  MemberKind,
  Org,
  OrgAvatar,
  OrgMark,
  OrgProduct,
  OrgSite,
  ProductStatus,
  SiteKind,
} from "./org.types";
import { MEMBER, PRODUCT_STATUS } from "./org.types";

/** The pull zone that serves the brand files and this JSON. */
export const CDN = "https://krizaka-assets.b-cdn.net";
export const ORG_URL = `${CDN}/org/v1/org.json`;
export const ORG_SCHEMA_URL = `${CDN}/org/v1/org.schema.json`;

const GROUPS: readonly FamilyGroup[] = ["krizaka", "products", "open-source", "github"];

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

type FamilyEntry = NonNullable<Org["family"]>[number];

const GITHUB = "https://github.com/krizaka";
const gh = (repo: string) => `${GITHUB}/${repo}`;

/** The public rows: a private member is in no view and never in `org.json`. */
const publicMembers = [...familyTable]
  .filter((m) => m.visibility === "public")
  .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order);

const PRODUCT_STATUSES: readonly string[] = PRODUCT_STATUS;
const SITE_KIND: Record<MemberKind, SiteKind | null> = {
  company: "company",
  blog: "company",
  product: "product",
  library: "docs",
  lab: "lab",
  github: null,
};

const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`Family table: ${what}.`);
  return value;
};

/** `products`: the public products, computed from the table. */
const products: OrgProduct[] = publicMembers
  .filter((m) => m.kind === MEMBER.product)
  .map((m) => {
    if (!PRODUCT_STATUSES.includes(m.status)) throw new Error(`Family table: product "${m.id}" is ${m.status}.`);
    return {
      id: m.id,
      name: m.name,
      status: m.status as ProductStatus,
      url: need(m.urls.site ?? undefined, `product "${m.id}" has no site`),
      repo: need(m.urls.repo ?? undefined, `product "${m.id}" has no repository`),
      mascot: need(m.mascot, `product "${m.id}" has no bird`).bird,
    };
  });

/** The family groups (the bar, the switcher and every footer): a member is linked at its live site, else at its repository. */
const groups: FamilyEntry[] = publicMembers.map((m) => ({
  id: m.id,
  name: m.name,
  short: m.short,
  group: m.group,
  status: m.status === MEMBER.released ? MEMBER.released : "development",
  ...(m.releasedAt ? { releasedAt: m.releasedAt } : {}),
  url: need((m.urls.siteLive ? m.urls.site : null) ?? m.urls.repo ?? undefined, `member "${m.id}" has no link`),
  repo: m.urls.repo,
}));

/** `sites`: the members whose site answers and that carry a bird. */
const SITES: OrgSite[] = publicMembers
  .filter((m) => m.urls.siteLive && m.urls.site && m.mascot && SITE_KIND[m.kind])
  .map((m) => ({
    id: m.id,
    name: m.siteName ?? m.name,
    url: m.urls.site as string,
    kind: SITE_KIND[m.kind] as SiteKind,
    mascot: m.mascot as OrgSite["mascot"],
    description: m.words.line,
    ...(m.aliases ? { aliases: m.aliases } : {}),
  }));

const SOCIAL = ["instagram", "facebook", "youtube", "linkedin"];

/** The shared selection of the developer sites: the whole family, every social account, the source, the licence, both legal links and the version line (founder target, krizaka-internal#754). */
/** A site that is not a developer site (the company, the blog, the products): the same family, legal line and socials; no source, licence or version. */
const companyFooter: FooterSite = {
  families: ["krizaka", "products", "open-source", "github"],
  social: SOCIAL,
  source: null,
  license: false,
  legal: ["privacy", "terms"],
  version: false,
};
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
  products,
  sites: SITES,
  family: groups,
  members: publicMembers,
  contact: {
    page: { fr: "https://www.krizaka.com/fr/contact", en: "https://www.krizaka.com/en/contact" },
    email: null,
  },
  links: {
    social: [
      { id: "instagram", label: "Instagram", url: "https://www.instagram.com/krizakahq/" },
      // The Page's own address as Meta's Graph API returns it (field `link`, read 2026-11-17): the Page has no username.
      { id: "facebook", label: "Facebook", url: "https://www.facebook.com/1482481631608218" },
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
      krizaka: companyFooter,
      blog: companyFooter,
      // The product sites (the coming-soon pages included): the family, the legal line and the socials, no source, no version.
      sovkora: companyFooter,
      verikora: companyFooter,
      folioviv: companyFooter,
      kridoc: companyFooter,
      ui: developerFooter(gh("krizaka-ui")),
      lab: developerFooter(gh("krizaka-lab")),
      // Java is no longer published on Maven Central (founder, 2026-11-14): the source link only.
      java: developerFooter(gh("krizaka-java")),
      ts: developerFooter(gh("krizaka-ts")),
      rust: developerFooter(gh("krizaka-rust")),
      // Private until its site answers: it resolves its own footer, and appears in no column until it is public and live.
      agents: companyFooter,
    },
  },
};
