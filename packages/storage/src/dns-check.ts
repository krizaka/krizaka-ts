import { lookup } from "node:dns/promises";
import net from "node:net";

import { checkEndpoint } from "./endpoint";
import { STORAGE_CODE, StorageError } from "./port";

/** A loopback, private, link-local, unspecified or unique-local address, v4 or v6 (an IPv4-mapped v6 address is read as its v4). */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/**
 * `checkEndpoint` (the written form) plus the DNS answer: a name that resolves to a private address is refused too, so a person's own
 * bucket can never make our server call our own network. `allowLocal` (development, MinIO on the Mac) skips both.
 * @returns the origin
 * @throws StorageError `STORAGE_BAD_ENDPOINT`
 */
export async function checkEndpointDns(endpoint: string, options: { allowLocal?: boolean; resolve?: Resolver } = {}): Promise<string> {
  const origin = checkEndpoint(endpoint, options.allowLocal ? { allowLocal: true } : {});
  if (options.allowLocal) return origin;
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !net.isIP(host)) throw new StorageError(STORAGE_CODE.badEndpoint, "endpoint must be a public host name");
  const addresses = net.isIP(host) ? [host] : await (options.resolve ?? defaultResolver)(host).catch(() => []);
  if (addresses.length === 0) throw new StorageError(STORAGE_CODE.badEndpoint, "endpoint does not resolve");
  if (addresses.some(isPrivateAddress)) throw new StorageError(STORAGE_CODE.badEndpoint, "endpoint must not be a private address");
  return origin;
}
