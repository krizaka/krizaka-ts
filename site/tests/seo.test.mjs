import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("robots.ts welcomes the AI crawlers of the Krizaka family", () => {
  const robots = read("app/robots.ts");
  for (const bot of [
    "GPTBot",
    "ClaudeBot",
    "PerplexityBot",
    "Google-Extended",
    "CCBot",
    "OAI-SearchBot",
    "Claude-SearchBot",
  ])
    assert.ok(robots.includes(`"${bot}"`), bot);
  assert.match(robots, /sitemap: `\$\{SITE_URL\}\/sitemap\.xml`/);
});

test("every JSON-LD node leads back to the Krizaka Organization and the home declares the source code", () => {
  const seo = read("lib/seo.ts");
  assert.match(seo, /ORG_ID = `\$\{KRIZAKA_URL\}\/#organization`/);
  assert.match(seo, /"@type": "SoftwareSourceCode"/);
  assert.match(seo, /"@type": "WebSite"/);
  assert.ok((seo.match(/publisher: ORG/g) ?? []).length >= 3);
});

test("every page names an Open Graph image, and the sitemap is dated by the build", () => {
  assert.match(read("lib/seo.ts"), /images: \[\{ url: OG_IMAGE/);
  assert.match(read("app/og.png/route.tsx"), /ImageResponse/);
  assert.match(read("app/sitemap.ts"), /lastModified/);
});

test("llms.txt points back to the family", () => {
  const post = read("scripts/postbuild.mjs");
  for (const url of [
    "https://www.krizaka.com",
    "https://ui.krizaka.com",
    "https://dev.orazaka.com",
    "https://dev.yomizaka.com",
    "https://dev.akinaza.com",
    "https://java.krizaka.com",
  ])
    assert.ok(post.includes(url), url);
});
