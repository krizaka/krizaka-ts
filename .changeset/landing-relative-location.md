---
"@krizaka/auth": patch
---

`landingRedirect` answers a relative `Location` (`/app`, not `https://localhost:3000/app`): behind a proxy or in CI the request URL carries an internal scheme and host, and an absolute `Location` sent the browser there (ERR_SSL_PROTOCOL_ERROR).
