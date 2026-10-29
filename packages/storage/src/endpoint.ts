import { STORAGE_CODE, StorageError } from "./port";

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./];

/**
 * An endpoint an administrator typed (their own bucket) is called by our server: it must not reach inside our network.
 * Refuses a non-https scheme, credentials in the URL, `localhost`, and literal private, loopback and link-local addresses.
 * A name that RESOLVES to a private address is not caught here: the product's network egress rules are the second guard.
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
  if (PRIVATE_V4.some((re) => re.test(host))) throw bad("must not be a private address");
  if (
    host.startsWith("[") &&
    (host === "[::1]" ||
      host.startsWith("[fc") ||
      host.startsWith("[fd") ||
      host.startsWith("[fe80") ||
      host.startsWith("[::ffff:"))
  )
    throw bad("must not be a private address");
  return url.origin;
}
