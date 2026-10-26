export { APP_SCHEMA_URL,apps } from "./apps";
export { CDN, org, ORG_SCHEMA_URL, ORG_URL } from "./org";
export { appSchema, orgSchema } from "./schema";
export type { AppConfig, AppEnvironment, Localized, Org, OrgAvatar, OrgBanner, OrgMark, OrgProduct, OrgSite, ProductStatus } from "./types";

import { org } from "./org";
import type { Localized } from "./types";

/** The text of a localized pair for a language (`fr` or `en`; anything else reads English). */
export const localized = (text: Localized, locale: string): string => (locale === "fr" ? text.fr : text.en);

/** The footer line of the family, « Une entreprise de Technologies Krizaka · Fait à Montréal ». */
export const footerLine = (locale: string): string => localized(org.footer.line, locale);
