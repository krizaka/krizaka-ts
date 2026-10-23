import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { source } from "@/lib/source";
import { jsonLd } from "@/lib/json-ld";
import { articleJsonLd, pageMetadata, pagePath } from "@/lib/seo";
import type { Locale } from "@/lib/i18n";
import { getMdxComponents } from "./mdx";

/* One page of the documentation, in one language: its title, description and body (MDX), the table of contents, and the
   JSON-LD (a BreadcrumbList and a TechArticle). The routes of both languages (app/(en), app/fr) are this. */

export const staticParamsOf = (locale: Locale) => source.getPages(locale).map((page) => ({ slug: page.slugs }));

function find(locale: Locale, slug: string[] | undefined) {
  const page = source.getPage(slug ?? [], locale);
  if (!page) notFound();
  return page;
}

export function metadataOf(locale: Locale, slug: string[] | undefined) {
  const page = find(locale, slug);
  return pageMetadata(locale, pagePath(page.slugs), page.data.title, page.data.description ?? "");
}

export default function DocPage({ locale, slug }: { locale: Locale; slug: string[] | undefined }) {
  const page = find(locale, slug);
  const MDX = page.data.body;
  const path = pagePath(page.slugs);
  const description = page.data.description ?? "";
  return (
    <>
      {articleJsonLd(locale, path, page.data.title, description).map((data, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      ))}
      <DocsPage toc={page.data.toc} full={page.data.full}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{description}</DocsDescription>
        <DocsBody>
          <MDX components={getMdxComponents(locale)} />
        </DocsBody>
      </DocsPage>
    </>
  );
}
