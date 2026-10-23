import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/* The AI crawlers and search bots the whole Krizaka family welcomes, so the documentation can be cited as a source in
   AI answers. The same list on every site (www.krizaka.com/AGENTS.md §2.4, scripts/check-seo-family.mjs). */
const CRAWLERS = [
  "Googlebot", "Google-Extended", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User",
  "Claude-SearchBot", "Claude-User", "ClaudeBot", "anthropic-ai", "Applebot", "Applebot-Extended", "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }, ...CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" }))],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
