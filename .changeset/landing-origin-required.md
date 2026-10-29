---
"@krizaka/auth": minor
---

`landingRedirect` throws in production (`NODE_ENV=production`) when `origin` is missing or empty: a deployment that forgot its declared public URL fails at the first request instead of redirecting to a Location built from client-controlled headers. Optional outside production.
