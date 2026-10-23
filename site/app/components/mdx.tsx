import type { AnchorHTMLAttributes } from "react";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { getDictionary, type Locale } from "@/lib/i18n";
import { npmPackageUrl } from "@/lib/site";
import { packages } from "@/lib/packages";
import InstallTabs from "./InstallTabs";

/** The components a page may use: `<InstallTabs name="…" />` (the install command in each package manager, with a copy
    button) and `<PackageTable />` (every package with what it is and its version on npm, from the generated data). */
export function getMdxComponents(locale: Locale): MDXComponents {
  const t = getDictionary(locale);
  const Anchor = defaultMdxComponents.a;
  return {
    ...defaultMdxComponents,
    // A link to another page of the documentation stays in the reader's language (/auth → /fr/auth).
    a: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <Anchor href={href?.startsWith("/") && !href.startsWith("//") ? `${locale === "fr" ? "/fr" : ""}${href}` : href} {...props} />,
    InstallTabs: ({ name }: { name: string }) => (
      <div className="not-prose" style={{ margin: "16px 0 24px" }}>
        <InstallTabs names={name} locale={locale} />
      </div>
    ),
    PackageTable: () => (
      <div className="kz-table-scroll not-prose">
        <table className="kz-table">
          <thead>
            <tr>
              <th scope="col">{t.start.packagesTable.package}</th>
              <th scope="col">{t.start.packagesTable.what}</th>
              <th scope="col">{t.start.packagesTable.version}</th>
            </tr>
          </thead>
          <tbody>
            {packages().map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  <a href={`${locale === "fr" ? "/fr" : ""}/${p.id}/`}>
                    <code>{p.name}</code>
                  </a>
                </th>
                <td>{t.packages[p.id as keyof typeof t.packages]?.hook}</td>
                <td>{p.version ? <a href={npmPackageUrl(p.name)}>{p.version}</a> : t.home.packages.unpublished}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
}
