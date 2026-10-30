export { APP_SCHEMA_URL, apps } from "./apps";
export type { CastPersona, CastProduct, CastRole } from "./cast";
export { CAST, CAST_VERSION, castMedia, castOf, persona, personaByRole, seedFingerprint } from "./cast";
export { DEFAULT_KINDS, defaultFor, defaults, defaultUrl, fetchDefaults, listDefaults, seedHash } from "./defaults";
export { CDN, org, ORG_SCHEMA_URL, ORG_URL } from "./org";
export type {
  AppConfig,
  AppEnvironment,
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
  ProductStatus,
} from "./org.types";
export { appSchema, orgSchema } from "./schema";

import { org } from "./org";
import type { Localized } from "./org.types";

/** The text of a localized pair for a language (`fr` or `en`; anything else reads English). */
export const localized = (text: Localized, locale: string): string => (locale === "fr" ? text.fr : text.en);

/** The footer line of the family, « Une entreprise de Technologies Krizaka · Fait à Montréal ». */
export const footerLine = (locale: string): string => localized(org.footer.line, locale);
