---
"@krizaka/rate-limit": minor
---

A global ceiling per action, whatever the address: `global` and `globalWindowSeconds` in the limits and in `rateLimitSettings`, one shared counter `global:<action>`, refusals with `scope: "global"` (status 503, `Retry-After`), `onTrip(action)` once per window, and a global scope that fails closed when the store errors (`globalFailOpen` to opt out).
