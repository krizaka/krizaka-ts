/** A text in both languages. */
export interface Localized {
  fr: string;
  en: string;
}

export type ProductStatus = "development" | "devPreview";

export interface OrgProduct {
  id: string;
  name: string;
  status: ProductStatus;
  /** The product's own site. */
  url: string;
  /** Its public source repository. */
  repo: string;
}

export interface OrgSite {
  id: string;
  name: string;
  url: string;
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

export interface OrgMark {
  svg: string;
  png64: string;
  png256: string;
  png512: string;
  png1024: string;
}

export interface Org {
  $schema: string;
  /** The contract: `1` while the shape is the one of `org/v1/org.json`. */
  schemaVersion: 1;
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
  people: {
    defaults: OrgAvatar[];
    banners: OrgBanner[];
  };
  /** Only the products that are live. */
  products: OrgProduct[];
  sites: OrgSite[];
  contact: {
    page: Localized;
    /** The public support address; `null` while none is public. */
    email: string | null;
  };
  footer: {
    line: Localized;
    legal: { id: "privacy" | "terms"; label: Localized; url: Localized }[];
  };
}

/** The part of an app's runtime config that depends on the environment. */
export type AppEnvironment = "dev" | "production";

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
