# @krizaka/auth

## 0.13.1

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.
- Updated dependencies [2272b57]
  - @krizaka/settings@0.5.2

## 0.13.0

### Minor Changes

- e3f2596: `landingRedirect` throws in production (`NODE_ENV=production`) when `origin` is missing or empty: a deployment that forgot its declared public URL fails at the first request instead of redirecting to a Location built from client-controlled headers. Optional outside production.

## 0.12.0

### Minor Changes

- db3fab1: `landingRedirect` takes an optional `origin` (the app's declared public origin, never the request's Host): the Location is then absolute on it, which a Next.js proxy accepts; without it the Location stays relative. Spoofed `Host` / `x-forwarded-*` never reach the Location (host-header injection).

## 0.11.2

### Patch Changes

- 723e1d9: `landingRedirect` answers a relative `Location` (`/app`, not `https://localhost:3000/app`): behind a proxy or in CI the request URL carries an internal scheme and host, and an absolute `Location` sent the browser there (ERR_SSL_PROTOCOL_ERROR).

## 0.11.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.11.0

### Minor Changes

- 2c1a96d: Loading `@krizaka/auth` no longer calls `crypto.scrypt` (a top-level `promisify`): a client component that imports the role model or `can` from the barrel would throw at load in the browser bundle (akinaza#515). The call now happens when a password is hashed or checked.
  
  New entry `@krizaka/auth/client`: `can`, `defineRoles`, `RoleModel`, `ROLES_CODE`, `RolesError` and the `/api/me` contract, with no `node:*` import — the import for client code. The repository now bundles every entry a package declares `krizaka.browserSafe` for the browser and fails on a node built-in (`scripts/browser-safe.test.mjs`).

## 0.10.0

### Minor Changes

- 5055f12: `landingRedirect` and `sessionHint` (krizaka-ui#827): the proxy-side rules of « a signed-in person never sees the public side ». A request with the session cookie on the landing route answers 307 to the product's home (`Cache-Control: private, no-store`, `Vary: Cookie`); `sessionHint` keeps a readable `kz-session=1` flag next to the HttpOnly cookie so the static pages' bar draws the signed-in placeholder on its first paint. The cookie is a hint, never an authorization.

## 0.9.1

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0

## 0.9.0

### Minor Changes

- 7a0026a: The basics every product copied, once (#57): `hashPassword`, `verifyPassword`, `passwordProblem` and `decoyHash` (the same scrypt format as the copies, so stored hashes verify); `clientIp(headers, { header, trustedProxyHops })`; sessions (`createSessions`, a `SessionStore` port, `dbSessionStore` over the product's `sessions` table, `memorySessionStore`, `sessionsSchema`, the cookie and `sessionTokenOf`), the token and its keyed hash identical to the copies', the lifetime from the new setting `auth.sessionDays`; `requireAdmin({ session, ip, allowedIps, surface })` and `allowedIps`; `@krizaka/auth/contract` (the `GET /api/me` contract, 200 `{ signedIn, signupOpen, account? }`, `private, no-store`, `Vary: Cookie`) and `@krizaka/auth/settings` (`authSettings`). `zod` becomes an optional peer dependency (for `./contract`).

## 0.8.0

### Minor Changes

- 273c554: `accountsSchema`, `rolesSchema` and `identityLinksSchema`: the accounts, roles and federated-links tables as `@krizaka/db` modules, version 1 byte-identical to `accountsMigration`, `rolesMigration` and `identityLinksMigration` (a product adopts with no DDL change). `Query` is `@krizaka/db`'s, re-exported under the same name. The three migration functions are deprecated (#51).

### Patch Changes

- Updated dependencies [273c554]
  - @krizaka/db@0.2.0

## 0.7.0

### Minor Changes

- 4326202: `Mail.link`: the password-reset and e-mail-change mails also hand their link to the product as data (`kind`, `url`, `minutes` or `hours`), so a product renders them with `@krizaka/email` (`passwordReset`, `emailChange`) instead of the plain text. Additive: `subject` and `text` are unchanged.

## 0.6.0

### Minor Changes

- c7478a9: Federated sign-in behind a port (#32): `IdentityProvider` (`start(provider, returnTo)`, `complete(code)` → a verified `ExternalIdentity`, PKCE for native apps), the adapter for krizaka-users (`usersIdentityProvider`) and an in-memory one, the link store (`dbIdentityLinks`, `identityLinksMigration`, never a second user table) and `createFederatedSignIn`, which attaches an identity to an existing account only when the address is verified on both sides. Conformance kits in `@krizaka/auth/testkit`.
- 5c6d9a6: Functional names for the technology-named exports (#30): `dbAccounts`, `dbApiKeyStore`, `dbSettings` (and the type `DbSettingsDeps`). The old `postgresAccounts`, `pgApiKeyStore`, `postgresSettings` and `PostgresSettingsDeps` stay as `@deprecated` aliases for this minor and go in the next major: move to the new names now.

## 0.5.0

### Minor Changes

- 50080a1: The password reset link's lifetime is configurable: `AccountDeps.passwordResetTtlMinutes` (a whole number from 5 to 1440, default 30 — `PASSWORD_RESET_TTL_MINUTES`, now only the default; out of range, `postgresAccounts` throws). The expiry and the mailed text (`passwordResetMail(product, locale, url, ttlMinutes?)`, FR and EN) both use it. `PASSWORD_RESET_MIN_MINUTES` and `PASSWORD_RESET_MAX_MINUTES` are exported.

## 0.4.0

### Minor Changes

- 10a5576: Password reset by a mailed link: `requestPasswordReset` (the same answer whether or not the address has an account; a new request retires the earlier link — the account row locked, one transaction), `resetPassword` (single use, 30 minutes, the new password checked before the link is used up; the link claimed, the password set and every session signed out in one transaction), `passwordResetMail` (FR/EN), `linkToken` / `isLinkToken` (one format for every mailed link), the `password_resets` table in `accountsMigration` (idempotent), and the optional `transaction` dependency of `postgresAccounts` (the product's pool runs the work on one connection; without it the statements run one by one).

## 0.3.0

### Minor Changes

- 246083a: Roles per scope as data: the role model, memberships, invitations by e-mail, `authorize`, the last owner protected, and `rolesMigration`.

## 0.2.0

### Minor Changes

- 4353745: The mail handed to the product carries `locale` (the person's), so an outbox can store it.

## 0.1.0

### Minor Changes

- fc5013c: First release: the account port, its PostgreSQL adapter and migration (profile, theme, e-mail change by link, password, sessions, export, deletion).
