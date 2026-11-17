---
"@krizaka/storage": minor
---

Security hardening of a typed bucket endpoint: `bucketStore` never follows a redirect (`redirect: "manual"`, a 3xx is a refusal), and outside `dev` the `s3` kind connects through the new `publicOnlyFetch` (`@krizaka/storage/node`), which judges the address at connect time. `OpenContext.endpointFetch` overrides it; the provider service builds it from its `resolve`. A consumer that opened `s3` in a `server` runtime with its own `fetch` now passes it as `endpointFetch`.
