import { describe, expect, it } from "vitest";

import { checkEndpointDns, isPrivateAddress } from "../src/node";

/** Every range an outbound call must never reach, IPv4 then IPv6, with one address at each edge where the edge matters. */
const NOT_PUBLIC: readonly (readonly [range: string, address: string])[] = [
  ["this network 0/8", "0.0.0.0"],
  ["this network 0/8", "0.255.255.255"],
  ["private 10/8", "10.0.0.1"],
  ["private 10/8", "10.255.255.255"],
  ["CGNAT 100.64/10", "100.64.0.1"],
  ["CGNAT 100.64/10", "100.127.255.255"],
  ["loopback 127/8", "127.0.0.1"],
  ["loopback 127/8", "127.255.255.254"],
  ["link-local 169.254/16", "169.254.169.254"],
  ["private 172.16/12", "172.16.0.1"],
  ["private 172.16/12", "172.31.255.255"],
  ["IETF protocol assignments 192.0.0/24", "192.0.0.8"],
  ["documentation TEST-NET-1 192.0.2/24", "192.0.2.1"],
  ["6to4 relay anycast 192.88.99/24", "192.88.99.1"],
  ["private 192.168/16", "192.168.1.1"],
  ["benchmarking 198.18/15", "198.18.0.1"],
  ["benchmarking 198.18/15", "198.19.255.255"],
  ["documentation TEST-NET-2 198.51.100/24", "198.51.100.7"],
  ["documentation TEST-NET-3 203.0.113/24", "203.0.113.9"],
  ["multicast 224/4", "224.0.0.1"],
  ["multicast 224/4", "239.255.255.250"],
  ["reserved 240/4", "240.0.0.1"],
  ["broadcast", "255.255.255.255"],
  ["unspecified ::", "::"],
  ["loopback ::1", "::1"],
  ["loopback ::1, written long", "0:0:0:0:0:0:0:1"],
  ["IPv4-compatible (deprecated)", "::10.0.0.1"],
  ["unique-local fc00::/7", "fc00::1"],
  ["unique-local fc00::/7", "fd12:3456:789a::1"],
  ["link-local fe80::/10", "fe80::1"],
  ["link-local fe80::/10", "febf::1"],
  ["link-local with a zone", "fe80::1%eth0"],
  ["site-local fec0::/10 (deprecated)", "fec0::1"],
  ["multicast ff00::/8", "ff02::1"],
  ["multicast ff00::/8", "ff0e::1"],
  ["documentation 2001:db8::/32", "2001:db8::1"],
  ["documentation 3fff::/20", "3fff::1"],
  ["discard-only 100::/64", "100::1"],
  ["Teredo / IETF assignments 2001::/23", "2001::1"],
  ["6to4 2002::/16", "2002:c000:0201::1"],
  ["NAT64 local-use 64:ff9b:1::/48", "64:ff9b:1::8.8.8.8"],
  ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
  ["IPv4-mapped private", "::ffff:10.0.0.1"],
  ["IPv4-mapped private, in hex", "::ffff:a00:1"],
  ["IPv4-mapped multicast", "::FFFF:224.0.0.1"],
  ["IPv4-mapped metadata", "0:0:0:0:0:ffff:169.254.169.254"],
  ["NAT64 64:ff9b::/96 with a private v4", "64:ff9b::10.0.0.1"],
  ["NAT64 64:ff9b::/96 with loopback, in hex", "64:ff9b::7f00:1"],
];

/** Anything that is not one IP literal: refused, so a caller that forgets to resolve never lets a name through. */
const NOT_AN_IP: readonly string[] = [
  "",
  " ",
  "localhost",
  "example.com",
  "not an address",
  "10.0.0.1 ",
  " 8.8.8.8",
  "010.0.0.1",
  "10.0.0",
  "10.0.0.1.1",
  "256.0.0.1",
  "0x7f.0.0.1",
  "2130706433",
  "[::1]",
  "::1::",
  "gggg::1",
  "8.8.8.8/32",
];

const PUBLIC: readonly string[] = [
  "8.8.8.8",
  "1.1.1.1",
  "93.184.216.34",
  "9.255.255.255",
  "11.0.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "172.15.255.255",
  "172.32.0.1",
  "192.0.1.1",
  "192.0.3.1",
  "192.169.0.1",
  "198.17.255.255",
  "198.20.0.0",
  "203.0.114.1",
  "223.255.255.255",
  "2606:4700::1111",
  "2001:4860:4860::8888",
  "2a00:1450:4007:80e::200e",
  "::ffff:8.8.8.8",
  "64:ff9b::8.8.8.8",
  "64:ff9b::808:808",
];

describe("isPrivateAddress (an SSRF guard: anything but a public unicast IP is refused)", () => {
  it.each(NOT_PUBLIC)("refuses %s: %s", (_range, address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(NOT_AN_IP)("fails closed on « %s », which is not an IP", (input) => {
    expect(isPrivateAddress(input)).toBe(true);
  });

  it.each(PUBLIC)("lets a public address through: %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("refuses the cases folioviv's local guard refused (krizaka/folioviv#731)", () => {
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("calendar.example.com")).toBe(true);
    expect(isPrivateAddress("garbage")).toBe(true);
  });

  it("refuses an endpoint whose name resolves to multicast, reserved or a mapped private address", async () => {
    for (const address of ["224.0.0.1", "240.0.0.1", "198.18.0.1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe"])
      await expect(
        checkEndpointDns("https://bucket.example.com", { resolve: async () => ["93.184.216.34", address] }),
      ).rejects.toMatchObject({ code: "STORAGE_BAD_ENDPOINT" });
  });
});
