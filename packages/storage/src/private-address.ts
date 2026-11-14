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

/** A strict dotted-quad: four decimal octets, no leading zero, nothing around it (the other spellings are the URL parser's job). */
const OCTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const V4 = new RegExp(String.raw`^${OCTET}(\.${OCTET}){3}$`);
/** What an IPv6 literal may hold: hex groups, colons and a dotted tail; no zone, no brackets, no prefix length, no space. */
const V6_CHARS = /^[\da-f:.]+$/i;

/** A subnet as the address bits it keeps (`bits`) once the host bits (`shift`) are dropped. */
interface Range {
  readonly bits: bigint;
  readonly shift: bigint;
}

const v4Bits = (v4: string) => v4.split(".").reduce((n, octet) => (n << 8n) | BigInt(octet), 0n);
const v6Bits = (groups: readonly number[]) => groups.reduce((n, group) => (n << 16n) | BigInt(group), 0n);

/**
 * The eight 16-bit groups of an IPv6 literal, read by the WHATWG URL parser (which validates it and turns a dotted tail into hex),
 * or null when it is not one. The URL parser is in every runtime, so the rule holds on Edge and in the browser too.
 */
function groupsOf(v6: string): number[] | null {
  if (!V6_CHARS.test(v6) || !v6.includes(":")) return null;
  let hex: string;
  try {
    hex = new URL(`http://[${v6}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head = "", tail] = hex.split("::");
  const parts = (s: string) => (s === "" ? [] : s.split(":").map((g) => Number.parseInt(g, 16)));
  if (tail === undefined) return parts(head);
  const [h, t] = [parts(head), parts(tail)];
  return [...h, ...new Array<number>(8 - h.length - t.length).fill(0), ...t];
}

function rangesOf(subnets: readonly Subnet[], width: number, bitsOf: (network: string) => bigint): readonly Range[] {
  return subnets.map(([network, prefix]) => {
    const shift = BigInt(width - prefix);
    return { bits: bitsOf(network) >> shift, shift };
  });
}

function v6NetworkBits(network: string): bigint {
  const groups = groupsOf(network);
  if (groups === null) throw new Error(`the range table holds ${network}, which is not an IPv6 network`);
  return v6Bits(groups);
}
const V4_BLOCKED = rangesOf(NOT_PUBLIC_V4, 32, v4Bits);
const V6_GLOBAL = rangesOf([GLOBAL_UNICAST_V6], 128, v6NetworkBits);
const V6_BLOCKED = rangesOf(NOT_PUBLIC_V6, 128, v6NetworkBits);
const inAny = (bits: bigint, ranges: readonly Range[]) => ranges.some((range) => bits >> range.shift === range.bits);

function embeddedV4(groups: readonly number[]): string | null {
  if (!EMBEDS_V4.some((prefix) => prefix.every((group, i) => groups[i] === group))) return null;
  const [hi = 0, lo = 0] = groups.slice(6);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** True when `host` is one IP literal (strict dotted-quad IPv4, or IPv6 without brackets or zone), false for a name or anything else. */
export function isIpLiteral(host: string): boolean {
  return V4.test(host) || groupsOf(host) !== null;
}

/**
 * True for anything that is not one public unicast IP literal: loopback, private, link-local, carrier-grade NAT, multicast, reserved,
 * benchmarking and documentation ranges, v4 and v6, an IPv4-mapped or NAT64 address judged by the IPv4 inside it, a scoped (`%zone`)
 * address, and any input that is not an IP at all. An SSRF guard fails closed: resolve a name first, then judge each address.
 * Pure (no `node:` import): the edge-safe `checkEndpoint` and the Node `checkEndpointDns` both judge with it.
 */
export function isPrivateAddress(address: string): boolean {
  if (V4.test(address)) return inAny(v4Bits(address), V4_BLOCKED);
  const groups = groupsOf(address);
  if (groups === null) return true;
  const v4 = embeddedV4(groups);
  if (v4 !== null) return isPrivateAddress(v4);
  const bits = v6Bits(groups);
  return !inAny(bits, V6_GLOBAL) || inAny(bits, V6_BLOCKED);
}
