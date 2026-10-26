---
"@krizaka/auth": minor
---

Federated sign-in behind a port (#32): `IdentityProvider` (`start(provider, returnTo)`, `complete(code)` → a verified `ExternalIdentity`, PKCE for native apps), the adapter for krizaka-users (`usersIdentityProvider`) and an in-memory one, the link store (`dbIdentityLinks`, `identityLinksMigration`, never a second user table) and `createFederatedSignIn`, which attaches an identity to an existing account only when the address is verified on both sides. Conformance kits in `@krizaka/auth/testkit`.
