import { BlockList, isIP } from "node:net";

type Subnet = readonly [network: string, prefix: number];

/** The IANA special-purpose IPv4 ranges (RFC 6890 and its updates): none is a public unicast address a server may call. */
const NOT_PUBLIC_V4: readonly Subnet[] = [
  ["0.0.0.0", 8], // « this network » (RFC 791)
  ["10.0.0.0", 8], // private (RFC 1918)
  ["100.64.0.0", 10], // carrier-grade NAT (RFC 6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, where cloud metadata answers
  ["172.16.0.0", 12], // private (RFC 1918)
  ["192.0.0.0", 24], // IETF protocol assignments (RFC 6890)
  ["192.0.2.0", 24], // documentation TEST-NET-1 (RFC 5737)
  ["192.88.99.0", 24], // 6to4 relay anycast, deprecated (RFC 7526)
  ["192.168.0.0", 16], // private (RFC 1918)
  ["198.18.0.0", 15], // benchmarking (RFC 2544)
  ["198.51.100.0", 24], // documentation TEST-NET-2
  ["203.0.113.0", 24], // documentation TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, with the broadcast 255.255.255.255
];

/** Public IPv6 is global unicast (2000::/3) only; inside it, these special-purpose ranges are not public either. */
const GLOBAL_UNICAST_V6: Subnet = ["2000::", 3];
const NOT_PUBLIC_V6: readonly Subnet[] = [
  ["2001::", 23], // IETF protocol assignments, Teredo (RFC 2928, RFC 4380)
  ["2001:db8::", 32], // documentation (RFC 3849)
  ["2002::", 16], // 6to4, deprecated (RFC 7526)
  ["3fff::", 20], // documentation (RFC 9637)
];

/** The six leading 16-bit groups of the IPv6 forms whose last 32 bits are an IPv4 address the call really reaches. */
const EMBEDS_V4: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0xffff], // IPv4-mapped ::ffff:0:0/96
  [0x64, 0xff9b, 0, 0, 0, 0], // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052)
];

function blockListOf(subnets: readonly Subnet[], family: "ipv4" | "ipv6"): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of subnets) list.addSubnet(network, prefix, family);
  return list;
}

const V4_BLOCKED = blockListOf(NOT_PUBLIC_V4, "ipv4");
const V6_GLOBAL = blockListOf([GLOBAL_UNICAST_V6], "ipv6");
const V6_BLOCKED = blockListOf(NOT_PUBLIC_V6, "ipv6");

/** The eight 16-bit groups of an IPv6 literal, read by the WHATWG URL parser (which also turns a dotted tail into hex). */
function groupsOf(v6: string): number[] {
  const hex = new URL(`http://[${v6}]`).hostname.slice(1, -1);
  const [head = "", tail] = hex.split("::");
  const parts = (s: string) => (s === "" ? [] : s.split(":").map((g) => Number.parseInt(g, 16)));
  if (tail === undefined) return parts(head);
  const [h, t] = [parts(head), parts(tail)];
  return [...h, ...Array<number>(8 - h.length - t.length).fill(0), ...t];
}

function embeddedV4(v6: string): string | null {
  const g = groupsOf(v6);
  if (!EMBEDS_V4.some((prefix) => prefix.every((group, i) => g[i] === group))) return null;
  const [hi = 0, lo = 0] = g.slice(6);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * True for anything that is not one public unicast IP literal: loopback, private, link-local, carrier-grade NAT, multicast, reserved,
 * benchmarking and documentation ranges, v4 and v6, an IPv4-mapped or NAT64 address judged by the IPv4 inside it, a scoped (`%zone`)
 * address, and any input that is not an IP at all. An SSRF guard fails closed: resolve a name first, then judge each address.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return V4_BLOCKED.check(address, "ipv4");
  if (family !== 6 || address.includes("%")) return true;
  const v4 = embeddedV4(address);
  if (v4 !== null) return isPrivateAddress(v4);
  return !V6_GLOBAL.check(address, "ipv6") || V6_BLOCKED.check(address, "ipv6");
}
