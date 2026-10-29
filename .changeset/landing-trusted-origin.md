---
"@krizaka/auth": minor
---

`landingRedirect` takes an optional `origin` (the app's declared public origin, never the request's Host): the Location is then absolute on it, which a Next.js proxy accepts; without it the Location stays relative. Spoofed `Host` / `x-forwarded-*` never reach the Location (host-header injection).
