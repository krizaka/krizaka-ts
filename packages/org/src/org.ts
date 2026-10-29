import pkg from "../package.json" with { type: "json" };
import { defaults as centralDefaults } from "./defaults";
import type { Localized, Org, OrgAvatar, OrgMark } from "./org.types";

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
export const org: Org = {
  $schema: ORG_SCHEMA_URL,
  schemaVersion: 2,
  version: pkg.version,
  updatedAt: "2026-10-26",
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
  people: {
    defaults,
    // No banner is published on the CDN yet; the set joins here with its alts when it is.
    banners: [],
  },
  defaults: centralDefaults,
  products: [
    {
      id: "orazaka",
      name: "Orazaka",
      status: "development",
      url: "https://dev.orazaka.com",
      repo: "https://github.com/krizaka/orazaka",
    },
    {
      id: "yomizaka",
      name: "Yomizaka",
      status: "development",
      url: "https://dev.yomizaka.com",
      repo: "https://github.com/krizaka/yomizaka",
    },
    {
      id: "akinaza",
      name: "Akinaza",
      status: "development",
      url: "https://dev.akinaza.com",
      repo: "https://github.com/krizaka/akinaza",
    },
  ],
  sites: [
    { id: "www", name: "krizaka.com", url: "https://www.krizaka.com" },
    { id: "ui", name: "Krizaka UI", url: "https://ui.krizaka.com" },
    { id: "java", name: "Krizaka Java", url: "https://java.krizaka.com" },
    { id: "ts", name: "Krizaka TS", url: "https://ts.krizaka.com" },
    { id: "motion", name: "Krizaka Lab", url: "https://lab.krizaka.com" },
    { id: "blog", name: "Blog", url: "https://blog.krizaka.com" },
  ],
  contact: {
    page: { fr: "https://www.krizaka.com/fr/contact", en: "https://www.krizaka.com/en/contact" },
    email: null,
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
  },
};
