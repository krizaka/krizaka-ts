import { STORAGE_CODE, StorageError } from "./port";
import { isIpLiteral, isPrivateAddress } from "./private-address";

/** The IP literal a URL hostname carries (IPv6 comes in brackets, IPv4 already in its canonical dotted form), or null for a name. */
function ipLiteralOf(host: string): string | null {
  if (host.startsWith("[")) return host.slice(1, -1);
  return isIpLiteral(host) ? host : null;
}

/**
 * An endpoint an administrator typed (their own bucket) is called by our server: it must not reach inside our network.
 * Refuses a non-https scheme, credentials in the URL, a local name (`localhost`, `.local`, `.internal`), and a literal address that
 * `isPrivateAddress` refuses (the one SSRF rule: any spelling of it, since the URL parser has made it canonical).
 * A name that RESOLVES to a private address is not caught here: `checkEndpointDns` (Node) and the network egress rules are.
 * `allowLocal` (development, MinIO on the Mac) lets `http` and local addresses through.
 * @returns the origin, without a trailing slash
 * @throws StorageError `STORAGE_BAD_ENDPOINT`
 */
export function checkEndpoint(endpoint: string, options: { allowLocal?: boolean } = {}): string {
  const bad = (why: string) => new StorageError(STORAGE_CODE.badEndpoint, `endpoint ${why}`);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw bad("is not a URL");
  }
  if (url.username !== "" || url.password !== "") throw bad("must not carry credentials");
  if (options.allowLocal) return url.origin;
  if (url.protocol !== "https:") throw bad("must be https");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))
    throw bad("must not be a local name");
  const literal = ipLiteralOf(host);
  if (literal !== null && isPrivateAddress(literal)) throw bad("must not be a private address");
  return url.origin;
}
