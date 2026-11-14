---
"@krizaka/storage": patch
---

Security fix: `checkEndpoint` (used alone by `createProviderRegistry` and the storage settings) now judges a literal host with `isPrivateAddress`, the same SSRF rule as `checkEndpointDns`, instead of its own shorter list. It now refuses CGNAT (100.64/10), multicast, reserved, benchmarking and documentation ranges, IPv4-mapped and NAT64 addresses in hex (`[::ffff:7f00:1]`, `[64:ff9b::a00:1]`), IPv6 multicast, site-local, 6to4, Teredo and everything outside global unicast, whatever the spelling (`https://2130706433`, `https://0x7f.0.0.1`). A host name that starts with digits (`https://10.example.com`) is no longer refused by mistake. `isPrivateAddress` no longer imports `node:net`: it is pure, so the edge-safe default entry can use it.
