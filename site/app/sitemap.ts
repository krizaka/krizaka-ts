import type { MetadataRoute } from "next";
import { LOCALES } from "@/lib/i18n";
import { absoluteUrl, pagePath } from "@/lib/seo";
import { source } from "@/lib/source";

const HOME = "/";

export const dynamic = "force-static";

/* The home, every page of the documentation, in both languages, each naming the other (hreflang), dated by the build. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const paths = [HOME, ...source.getPages("en").map((page) => pagePath(page.slugs))];
  return paths.flatMap((path) => {
    const languages = Object.fromEntries(LOCALES.map((l) => [l, absoluteUrl(l, path)]));
    return LOCALES.map((l) => ({ url: absoluteUrl(l, path), lastModified, alternates: { languages } }));
  });
}
