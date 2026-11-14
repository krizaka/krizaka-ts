---
"@krizaka/storage": patch
---

Security fix: `isPrivateAddress`, the SSRF guard behind `checkEndpointDns`, now fails closed. It refuses multicast (224/4, ff00::/8), reserved (240/4, broadcast), benchmarking (198.18/15), documentation (192.0.2/24, 198.51.100/24, 203.0.113/24, 2001:db8::/32, 3fff::/20), IETF assignments, 6to4, Teredo, deprecated site-local and every IPv6 address outside global unicast, judges an IPv4-mapped or NAT64 (64:ff9b::/96) address by the IPv4 inside it (dotted or hex), and returns `true` for a scoped address or any input that is not an IP literal. Before, a multicast address, a hostname or garbage were « not private ». The ranges are data read by `node:net`'s `BlockList`.
