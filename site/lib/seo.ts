/* Canonical URLs, alternates, Open Graph and JSON-LD of a page. Every page is canonical to itself in its own language and
   names the other one (hreflang); the root of English is also x-default. */

import type { Metadata } from "next";
import { getDictionary, localizedPath, LOCALES, type Locale } from "./i18n";
import { KRIZAKA_URL, REPOSITORY_URL, SITE_URL } from "./site";
import { packages } from "./packages";

/** The Krizaka Organization, defined by www.krizaka.com: every JSON-LD node of the family points back to it. */
export const ORG_ID = `${KRIZAKA_URL}/#organization`;
const ORG = { "@type": "Organization", "@id": ORG_ID, name: "Krizaka", url: KRIZAKA_URL };
/** One social image for every page (app/og.png/route.tsx). */
export const OG_IMAGE = `${SITE_URL}/og.png`;

export const absoluteUrl = (locale: Locale, path: string) => `${SITE_URL}${localizedPath(locale, path)}`;

export const pagePath = (slugs: string[]) => (slugs.length ? `/${slugs.join("/")}` : "/");

export function pageMetadata(locale: Locale, path: string, title: string, description: string): Metadata {
  const t = getDictionary(locale);
  const fullTitle = path === "/" ? title : `${title} — ${t.site.name}`;
  const url = absoluteUrl(locale, path);
  return {
    title: { absolute: fullTitle },
    description,
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, absoluteUrl(l, path)])),
        "x-default": absoluteUrl("en", path),
      },
    },
    openGraph: {
      type: path === "/" ? "website" : "article",
      siteName: t.site.name,
      title: fullTitle,
      description,
      url,
      locale: locale === "en" ? "en_US" : "fr_CA",
      alternateLocale: locale === "en" ? "fr_CA" : "en_US",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: t.site.name }],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [OG_IMAGE] },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icon.png", sizes: "32x32", type: "image/png" },
      ],
      apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    },
  };
}

export function articleJsonLd(locale: Locale, path: string, title: string, description: string) {
  const t = getDictionary(locale);
  const url = absoluteUrl(locale, path);
  const crumbs = [
    { name: t.site.name, url: absoluteUrl(locale, "/") },
    ...(path === "/" ? [] : [{ name: title, url }]),
  ];
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
    },
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: title,
      description,
      url,
      inLanguage: locale,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      author: { "@id": ORG_ID },
      publisher: ORG,
    },
  ];
}

/** The home's metadata: its own title and description (messages), canonical to itself, hreflang to the other language. */
export function homeMetadata(locale: Locale): Metadata {
  const h = getDictionary(locale).home;
  return pageMetadata(locale, "/", h.metaTitle, h.metaDescription);
}

/** The home's JSON-LD: the WebPage in its language, the WebSite and the source code it documents (Krizaka TypeScript), all published by the Krizaka Organization. */
export function homeJsonLd(locale: Locale) {
  const h = getDictionary(locale).home;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${absoluteUrl(locale, "/")}#webpage`,
      url: absoluteUrl(locale, "/"),
      name: h.metaTitle,
      description: h.metaDescription,
      inLanguage: locale,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#source` },
      publisher: ORG,
    },
    ...siteJsonLd(locale),
  ];
}

/** The home: the WebSite and the source code it documents (Krizaka TypeScript), both published by the Krizaka Organization.
    No SearchAction: the search is a dialog (⌘K) over a static index, there is no search URL to declare. */
function runtime(): string {
  const node = [
    ...new Set(
      packages()
        .map((p) => p.node)
        .filter(Boolean),
    ),
  ];
  return node.length === 1 ? `Node.js ${node[0]}` : "Node.js";
}

function siteJsonLd(locale: Locale) {
  const t = getDictionary(locale);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: t.site.name,
      inLanguage: ["en", "fr"],
      publisher: ORG,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      "@id": `${SITE_URL}/#source`,
      name: t.site.name,
      url: SITE_URL,
      description: t.site.description,
      codeRepository: REPOSITORY_URL,
      programmingLanguage: "TypeScript",
      runtimePlatform: runtime(),
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      isAccessibleForFree: true,
      publisher: ORG,
      isPartOf: { "@id": `${SITE_URL}/#website` },
    },
  ];
}
