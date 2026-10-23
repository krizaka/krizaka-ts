/* i18n — every user-facing string lives in messages/<locale>.json (the words of the pages are content/docs/*.mdx and
   *.fr.mdx). en.json is the reference: its shape is the TranslationDictionary type, a key missing from fr.json fails
   type-checking, and `npm run lint` runs `krizaka-i18n check messages`. The engine is @krizaka/i18n, shared by every
   Krizaka app. English is served at the root (`/`), French under `/fr/`. */

import { createI18n } from "@krizaka/i18n";
import en from "@/messages/en.json";
import frMessages from "@/messages/fr.json";

export type Locale = "en" | "fr";
export const LOCALES: readonly Locale[] = ["en", "fr"];
export const DEFAULT_LOCALE: Locale = "en";

export type TranslationDictionary = typeof en;
const fr: TranslationDictionary = frMessages;

export const i18n = createI18n<TranslationDictionary, Locale>({ en, fr }, { defaultLocale: DEFAULT_LOCALE });
export const getDictionary = (locale: Locale): TranslationDictionary => i18n.getDictionary(locale);
export { format } from "@krizaka/i18n";

/** The URL of a path in a language: English at the root, French under /fr. `path` starts with "/" (the root is "/"). */
export function localizedPath(locale: Locale, path: string): string {
  const clean = path === "/" ? "" : path.replace(/\/$/, "");
  return `${locale === "en" ? "" : "/fr"}${clean}/`;
}

/** The language of a URL path, and the path without its language prefix. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const m = pathname.match(/^\/fr(\/.*)?$/);
  return m ? { locale: "fr", path: m[1] ?? "/" } : { locale: "en", path: pathname || "/" };
}
