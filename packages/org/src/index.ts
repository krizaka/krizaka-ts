export { APP_SCHEMA_URL, apps } from "./apps";
export type { BrandKind, CodeNameHit, OrgBrand } from "./brands";
export {
  brandOf,
  brands,
  catalogueValues,
  CODE_NAMES,
  codeNameMap,
  DISPLAY_NAME_MAX,
  displayName,
  findCodeNames,
  lockup,
  visibleText,
} from "./brands";
export type { CastPersona, CastProduct, CastRole } from "./cast";
export { CAST, CAST_VERSION, castMedia, castOf, persona, personaByRole, seedFingerprint } from "./cast";
export { DEFAULT_KINDS, defaultFor, defaults, defaultUrl, fetchDefaults, listDefaults, seedHash } from "./defaults";
export { CDN, org, ORG_SCHEMA_URL, ORG_URL } from "./org";
export type {
  AppConfig,
  AppEnvironment,
  FamilyEntry,
  FamilyGroup,
  FamilyStatus,
  FooterSite,
  LegalId,
  Localized,
  Org,
  OrgAvatar,
  OrgBanner,
  OrgDefaultItem,
  OrgDefaultKind,
  OrgDefaults,
  OrgMark,
  OrgProduct,
  OrgSite,
  OrgSocialLink,
  ProductStatus,
  ResolvedFooter,
} from "./org.types";
export { PRODUCT_STATUS } from "./org.types";
export { appSchema, orgSchema } from "./schema";

import { org } from "./org";
import type { Localized, ResolvedFooter } from "./org.types";

/** The text of a localized pair for a language (`fr` or `en`; anything else reads English). */
export const localized = (text: Localized, locale: string): string => (locale === "fr" ? text.fr : text.en);

/** The footer line of the family, « Une entreprise de Technologies Krizaka · Fait à Montréal ». */
export const footerLine = (locale: string): string => localized(org.footer.line, locale);

/** A name of the family by id (`familyName("ts")` → « Krizaka TypeScript »): the only way a site writes one. */
export const familyEntry = (id: string) => {
  const entry = org.family.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown Krizaka family entry "${id}".`);
  return entry;
};
export const familyName = (id: string): string => familyEntry(id).name;

/**
 * What the footer of a site shows, resolved from the org data (`footer.sites`): the family groups with their entries, the social
 * accounts, the legal links, the line. A site renders it and never filters by hand; an unknown site id throws.
 */
export const footerFor = (siteId: string): ResolvedFooter => {
  const sel = org.footer.sites[siteId];
  if (!sel) throw new Error(`Unknown footer site "${siteId}".`);
  const pick = <T extends { id: string }>(all: T[], ids: string[]) =>
    ids.map((id) => {
      const found = all.find((x) => x.id === id);
      if (!found) throw new Error(`Footer of "${siteId}": unknown id "${id}".`);
      return found;
    });
  return {
    id: siteId,
    groups: sel.families.map((group) => ({ group, entries: org.family.filter((e) => e.group === group) })),
    social: pick(org.links.social, sel.social),
    source: sel.source,
    license: sel.license ? org.company.license : null,
    legal: pick(org.footer.legal, sel.legal),
    line: org.footer.line,
    version: sel.version,
  };
};
