---
"@krizaka/auth": minor
---

The basics every product copied, once (#57): `hashPassword`, `verifyPassword`, `passwordProblem` and `decoyHash` (the same scrypt format as the copies, so stored hashes verify); `clientIp(headers, { header, trustedProxyHops })`; sessions (`createSessions`, a `SessionStore` port, `dbSessionStore` over the product's `sessions` table, `memorySessionStore`, `sessionsSchema`, the cookie and `sessionTokenOf`), the token and its keyed hash identical to the copies', the lifetime from the new setting `auth.sessionDays`; `requireAdmin({ session, ip, allowedIps, surface })` and `allowedIps`; `@krizaka/auth/contract` (the `GET /api/me` contract, 200 `{ signedIn, signupOpen, account? }`, `private, no-store`, `Vary: Cookie`) and `@krizaka/auth/settings` (`authSettings`). `zod` becomes an optional peer dependency (for `./contract`).
