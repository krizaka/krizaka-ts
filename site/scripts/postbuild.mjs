#!/usr/bin/env node
/* After `next build`: llms.txt and llms-full.txt (the documentation as plain text for assistants), written next to the pages
   in out/. Both are rendered from content/docs (English: the start page and one page per package), with the versions npm lists. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const SITE = "https://ts.krizaka.com";
const packages = JSON.parse(readFileSync(join(root, "lib/generated/packages.json"), "utf8")).packages;
const versions = Object.fromEntries(packages.map((p) => [p.name, p.version]));

const frontmatter = (src) => {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  const field = (k) => m?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
  return { title: field("title"), description: field("description"), body: m ? src.slice(m[0].length) : src };
};
const plain = (body) =>
  body
    .replace(/%(@krizaka\/[a-z0-9-]+)%/g, (_, name) => versions[name] ?? "")
    .replace(/^<InstallTabs name="([^"]+)" \/>$/gm, (_, name) => `\`\`\`bash\nnpm install ${name}\n\`\`\``)
    .replace(/^<PackageTable \/>\s*$/gm, packages.map((p) => `- ${p.name}${p.version ? ` ${p.version}` : ""}: ${SITE}/${p.id}/`).join("\n"))
    .replace(/\\([{}])/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const dir = join(root, "content/docs");
const pages = ["start", ...packages.map((p) => p.id)].map((slug) => {
  const { title, description, body } = frontmatter(readFileSync(join(dir, `${slug}.mdx`), "utf8"));
  return { slug, title, description, url: `${SITE}/${slug}/`, text: plain(body) };
});

const head = `# Krizaka TS\n\n> The TypeScript backend building blocks of every Krizaka product — accounts, settings, API keys, webhooks, organization and the weekly brief, published on npm under @krizaka (Apache-2.0). A Krizaka open-source project (https://www.krizaka.com). French pages are under ${SITE}/fr/.\n`;
/* The way back to the family: the company, the sibling open-source projects, the products, the source. */
const family = `## The Krizaka family\n\n- [Krizaka](https://www.krizaka.com): the company, open-source software studio in Montréal\n- [Krizaka UI](https://ui.krizaka.com): the design system (React and React Native)\n- [Krizaka Java](https://java.krizaka.com): the Spring Boot building blocks\n- [Orazaka](https://dev.orazaka.com): sovereign, on-premise AI orchestration\n- [Orochia](https://dev.orochia.com): open-source video platform\n- [Source](https://github.com/krizaka/krizaka-ts): this repository, Apache-2.0\n\nSitemap: ${SITE}/sitemap.xml\n`;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "llms.txt"), `${head}\n## Packages\n\n${pages.map((p) => `- [${p.title}](${p.url}): ${p.description}`).join("\n")}\n\n${family}`);
writeFileSync(join(out, "llms-full.txt"), `${head}\n${pages.map((p) => `\n---\n\n# ${p.title}\n\nURL: ${p.url}\n\n${p.text}`).join("\n")}\n\n---\n\n${family}`);
console.log(`postbuild: llms.txt, llms-full.txt (${pages.length} pages)`);
