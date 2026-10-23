/* The documentation: one Fumadocs collection (content/docs), `page.mdx` in English and `page.fr.mdx` in French. */

import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n";

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  i18n: { languages: [...LOCALES], defaultLanguage: DEFAULT_LOCALE, parser: "dot", hideLocale: "default-locale" },
});

export const pagesOf = (locale: Locale) => source.getPages(locale);
export const treeOf = (locale: Locale) => source.getPageTree(locale);
