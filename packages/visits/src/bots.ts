/**
 * Known crawlers and tools, matched on the User-Agent (lower case, by inclusion). The agent is read to be refused, never kept. An
 * empty agent is a bot too: a browser always sends one.
 */
const BOT_MARKERS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "facebookexternalhit",
  "embedly",
  "preview",
  "monitor",
  "uptime",
  "lighthouse",
  "headless",
  "curl/",
  "wget",
  "python-requests",
  "httpclient",
  "axios",
  "node-fetch",
  "go-http",
  "java/",
  "okhttp",
  "libwww",
  "scrapy",
  "pingdom",
  "claude",
  "perplexity",
  "ccbot",
  "bytespider",
  "applebot",
  "datadog",
  "statuscake",
  "screenshot",
] as const;

export function isBot(userAgent: string | null | undefined): boolean {
  const agent = userAgent?.trim().toLowerCase();
  return !agent || BOT_MARKERS.some((marker) => agent.includes(marker));
}
