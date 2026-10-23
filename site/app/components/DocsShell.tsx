import type { CSSProperties, ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { localizedPath, getDictionary, type Locale } from "@/lib/i18n";
import { treeOf } from "@/lib/source";

/* The documentation's frame: Fumadocs' layout (the sidebar of content/docs, the table of contents) under the bar. The home
   (app/(en)/page.tsx) is outside it: a landing page has no sidebar. Both languages' (docs) layouts are this. */
export default function DocsShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getDictionary(locale);
  return (
    <DocsLayout
      tree={treeOf(locale)}
      nav={{ title: t.site.name, url: localizedPath(locale, "/") }}
      themeSwitch={{ enabled: false }}
      containerProps={{ className: "kz-docs", style: { "--fd-banner-height": "var(--kz-docs-top)" } as CSSProperties }}
    >
      {children}
    </DocsLayout>
  );
}
