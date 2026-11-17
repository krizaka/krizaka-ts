/**
 * The referrer reduced to its domain: no path, no query, no port, no « www. ». Empty when there is none, when it is not an http(s)
 * address, or when it is the site itself (an internal move is not a source). Never the full address.
 * @param ownHosts the hosts of the site and its siblings, whose visits come from itself
 */
export function referrerDomain(referer: string | null | undefined, ownHosts: readonly string[] = []): string {
  if (!referer) return "";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  const domain = bare(url.hostname);
  // @fixed: DNS names stop at 253 characters; longer is not a domain
  if (!domain || domain.length > 253 || ownHosts.some((own) => bare(own) === domain)) return "";
  return domain;
}
