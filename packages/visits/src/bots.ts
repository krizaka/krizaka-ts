/**
 * Known crawlers and tools, matched on the User-Agent. The agent is read to be refused, never kept. An empty agent is a bot too: a
 * browser always sends one.
 */
const BOT =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|uptime|lighthouse|headless|curl\/|wget|python-requests|httpclient|axios|node-fetch|go-http|java\/|okhttp|libwww|scrapy|pingdom|gptbot|claude|perplexity|ccbot|bytespider|applebot|bingpreview|datadog|statuscake|vercel-screenshot/i;

export function isBot(userAgent: string | null | undefined): boolean {
  const agent = userAgent?.trim();
  return !agent || BOT.test(agent);
}
