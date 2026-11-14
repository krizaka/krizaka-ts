import { lookup } from "node:dns/promises";
import net from "node:net";

import { checkEndpoint } from "./endpoint";
import { STORAGE_CODE, StorageError } from "./port";
import { isPrivateAddress } from "./private-address";

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/**
 * `checkEndpoint` (the written form) plus the DNS answer: a name that resolves to a private address is refused too, so a person's own
 * bucket can never make our server call our own network. `allowLocal` (development, MinIO on the Mac) skips both.
 * @returns the origin
 * @throws StorageError `STORAGE_BAD_ENDPOINT`
 */
export async function checkEndpointDns(
  endpoint: string,
  options: { allowLocal?: boolean; resolve?: Resolver } = {},
): Promise<string> {
  const origin = checkEndpoint(endpoint, options.allowLocal ? { allowLocal: true } : {});
  if (options.allowLocal) return origin;
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !net.isIP(host))
    throw new StorageError(STORAGE_CODE.badEndpoint, "endpoint must be a public host name");
  const addresses = net.isIP(host) ? [host] : await (options.resolve ?? defaultResolver)(host).catch(() => []);
  if (addresses.length === 0) throw new StorageError(STORAGE_CODE.badEndpoint, "endpoint does not resolve");
  if (addresses.some(isPrivateAddress))
    throw new StorageError(STORAGE_CODE.badEndpoint, "endpoint must not be a private address");
  return origin;
}
