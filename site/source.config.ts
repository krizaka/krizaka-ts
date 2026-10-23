/* Fumadocs collection: the guides of Krizaka Java, written in this repository (content/docs, English and French —
   `page.mdx` and `page.fr.mdx`). The words that are data — the versions on Maven Central — are tokens (`%bom%`) the
   remark plugin below replaces at build; the building blocks map is generated from the POMs, never written here. */

import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { remarkVersions } from "./lib/remark-versions";

export const docs = defineDocs({ dir: "content/docs" });

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (defaults) => [remarkVersions, ...defaults],
    rehypeCodeOptions: { themes: { light: "github-light", dark: "github-dark" } },
  },
});
