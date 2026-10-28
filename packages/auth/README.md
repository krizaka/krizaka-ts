# @krizaka/auth

The account of a Krizaka product, behind a port: a display name, language, theme and avatar seed; the e-mail change by a link mailed to the **new** address (the verified flag is set by that very act); the password (checked before anything sensitive, other sessions signed out on change; reset by a link mailed to the account's address — the same answer whether or not the address has an account, the link used once within 30 minutes by default — `passwordResetTtlMinutes`, 5 to 1440, read by the product from its settings and said in the mail — every session signed out); the live sessions with sign-out of the others; the data export; the deletion. Each product keeps its **own** accounts — the package brings an adapter over the product's PostgreSQL and the migration it needs, nothing central.

```ts
import { emitMigration } from "@krizaka/db";
import { accountsSchema, dbAccounts } from "@krizaka/auth";

emitMigration(accountsSchema({ backfillVerified: true }), 1, { tables: { accounts: "accounts" } }); // commit the SQL once, in your migrations (idempotent)
const accounts = dbAccounts({ query, transaction, mail, baseUrl: "https://www.akinaza.com", product: "Akinaza", tokenPrefix: "ae", passwords: { hash, verify }, tokenHash, passwordResetTtlMinutes: 30 /* optional, 5–1440 */ }); // `transaction`: the work on one connection (BEGIN … COMMIT); the password reset needs it under concurrent requests
await accounts.updateProfile(id, { name: "Éric", theme: "dark" });
await accounts.sessions(id, new Date(), currentSessionId);
await accounts.requestPasswordReset(email, new Date()); // mails `<baseUrl>/<locale>/reset-password?token=…`
await accounts.resetPassword(token, newPassword, new Date()); // "CHANGED" | "INVALID"
```

**Schema.** The tables are a `@krizaka/db` module (`auth`), version 1 byte-identical to the SQL this package shipped before, so a product that has them adopts with no DDL change: `adoptMigration(accountsSchema(), 1, context)` writes the marker only, `emitMigration(…)` writes the SQL for a database that lacks them. The old migration function stays, `@deprecated`, for one minor. The roles are the module `auth_roles` (`rolesSchema(roles, { scoped })`, tables `owner` and `scope`) and the federated links `auth_identity_links` (`identityLinksSchema`).
A link mail carries `mail.link` (`kind`, `url`, `minutes` or `hours`) beside `subject` and `text`: a product that sends branded HTML (`@krizaka/email`: `passwordReset`, `emailChange`) renders it from the data.

The product keeps what is its own: its session cookie and token hashing (`tokenHash`), its password hashing, its mailer, its rate limits and its HTTP answers (`AccountError` carries a status and a stable code). Time is passed in (`now`); nothing here reads the clock.

## Roles per scope

A role model is data: `defineRoles({ roles, permissions, manages })` says which roles exist, what each may do and who may hand which role to whom. `createRoles` keeps memberships (one person, several scopes, a role in each) and invitations (an e-mail invited with a role, a link used once, only its hash kept, never demoting), refuses to remove or demote the last owner, and answers `authorize(account, scope, "invoices")` with the role or a stable refusal (`NOT_A_MEMBER` 404, `FORBIDDEN` 403). `rolesMigration(roles, { scopeTable })` makes the tables.

## Federated sign-in (Google, Apple, Facebook, native PKCE)

Each product keeps its own accounts; **krizaka-users** is the federation provider behind a port, so a product holds no OAuth app of its own. `IdentityProvider` has two calls: `start(provider, returnTo, { codeChallenge? })` gives the address to send the person to, `complete(code, { codeVerifier? })` exchanges the one-time code (single use) for a verified `ExternalIdentity` (`issuer`, `subject`, `email`, `emailVerified`). A return address stays on the product (a path); an unknown provider is refused.

```ts
import { createFederatedSignIn, dbIdentityLinks, identityLinksSchema, usersIdentityProvider } from "@krizaka/auth";

emitMigration(identityLinksSchema, 1, { tables: { accounts: "accounts" } }); // once, in your migrations (idempotent): (issuer, subject) → account
const federation = usersIdentityProvider({ baseUrl: "https://auth.dev.akinaza.com", appUrl: "https://dev.akinaza.com", fetch });
const signIn = createFederatedSignIn({ links: dbIdentityLinks(query), accounts: { findByEmail, create }, clock });

const { url } = await federation.start("google", "/fr/account"); // redirect there
const result = await signIn.signIn(await federation.complete(code)); // { status: "signed-in", accountId, via } | { status: "refused", code }
```

An external identity attaches to an existing account **only when the address is verified on both sides** (by the provider and by the product); otherwise it is refused (`EMAIL_NOT_VERIFIED`, `ACCOUNT_EMAIL_UNVERIFIED`), and it is never a second user table. `create` is optional: leave it out and a person without an account is refused (`NO_ACCOUNT`). Adapters run the conformance kits of `@krizaka/auth/testkit` (`identityProviderContract`, `identityLinkStoreContract`).

> `postgresAccounts` was the first name of `dbAccounts`; it stays as a `@deprecated` alias for one minor and leaves in the next major.

## A signed-in visitor never sees the public side

In the product's `proxy.ts` (Web `Request`/`Response`, no framework): `landingRedirect(request, { cookie, landing: ["/", "/fr", "/en"], home })` answers 307 to the home with `Cache-Control: private, no-store` and `Vary: Cookie` when the session cookie exists on a landing route, else `null`. `sessionHint(response, request, { cookie, secure })` keeps the readable `kz-session=1` flag in step with the cookie (never the token), so the static pages stay the same for everyone and `NavBarSession` of `@krizaka/ui` draws the signed-in placeholder on its first paint. Both read the cookie as a hint only: the page and the API still resolve the session.

## Sessions, passwords, addresses and the administration's locks

What Yomizaka, Akinaza, Kachizaka and Yororis each copied (`password.ts`, `client-ip.ts`, `session.ts`, the admin gate of `access.ts`) is here once. Each piece is a function of its inputs: the product reads its environment and its framework, and passes values.

```ts
import { allowedIps, clientIp, createSessions, dbSessionStore, hashPassword, requireAdmin, sessionCookie, sessionTokenOf, verifyPassword } from "@krizaka/auth";

const sessions = createSessions({
  store: dbSessionStore(query, { columns: ["id", "email", "role", "locale"], toAccount: (row) => ({ id: String(row.id), email: String(row.email), role: row.role as "USER" | "ADMIN", locale: row.locale as "en" | "fr" }), active: { column: "status", equals: "ACTIVE" } }),
  clock: { now: () => new Date() },
  tokenPrefix: "ys",                       // tokens are `ys1.<43 characters>`
  secret: () => env.AUTH_SESSION_SECRET,   // keys the stored hash (HMAC-SHA256)
  sessionDays: () => settings.get("auth.sessionDays"), // the setting, read for each new session
});

const ip = clientIp(request.headers, { header: env.ABUSE_CLIENT_IP_HEADER, trustedProxyHops: env.ABUSE_TRUSTED_PROXY_HOPS });
const { token, expires } = await sessions.create(account.id, { ip, userAgent: request.headers.get("user-agent") });
cookies().set(sessionCookie(token, expires, { name: "yomizaka_session", secure: production }));

const session = await sessions.resolve(sessionTokenOf(request.headers, { cookie: "yomizaka_session" })); // bearer of a native app, else the cookie
const verdict = requireAdmin({ session, ip, allowedIps: allowedIps(env.AUTH_ALLOWED_IPS, { production }), surface: "api" }); // { ok: true } | { ok: false, status, code }
```

- **Passwords:** `hashPassword` and `verifyPassword` are scrypt (N=2^15, r=8, p=1), stored `scrypt$N$r$p$salt$hash`, the format of the copies: a hash a product stored verifies here (a test pins one). `passwordProblem` (12 to 256 characters) and `decoyHash` (verify against it when the address has no account: the same work, the same time). Hand them to `dbAccounts({ passwords: { hash: hashPassword, verify: verifyPassword } })`.
- **Client address:** `clientIp(headers, { header, trustedProxyHops })` reads the header the edge sets, else the entry `trustedProxyHops` from the right of `X-Forwarded-For` (never the left: the client writes it), else `X-Real-IP`, else null.
- **Sessions:** a `SessionStore` port with `dbSessionStore` (the product's `sessions` table, declared as parameters: the table names and the account columns are checked, and a suspended account signs nobody in at once), `memorySessionStore` for tests, and `sessionsSchema` for a product without the table. The token is shown once; only its HMAC is stored, with the same formula as the copies, so sessions already stored keep working. A session lasts `sessionDays` of 24 hours from the clock.
- **The administration's locks:** `requireAdmin({ session, ip, allowedIps, surface })` decides on the three locks (a session, the ADMIN role, an address on the list) and answers the status and code: on the API 401 or 403 with `UNAUTHENTICATED`, `FORBIDDEN` or `IP_NOT_ALLOWED`; on a page 404 for every failed lock, because the administration does not announce itself. `allowedIps(list, { production })` makes an empty list « nobody » in production and « anybody » in development.
- **`@krizaka/auth/contract`** (browser-safe, needs `zod`): `GET /api/me` answers **200** `{ signedIn, signupOpen, account? }` with `Cache-Control: private, no-store` and `Vary: Cookie` (krizaka-ui#551). Signed out is not an error. `meResponse({ signupOpen, account })` builds the answer and checks it against `meSchema`; the bar island of `@krizaka/ui` reads the same file.
- **`@krizaka/auth/settings`** (needs `@krizaka/settings`): the registry fragment `authSettings`: `auth.sessionDays` (14, 1 to 90) and `auth.passwordResetMinutes` (30, 5 to 1440).
- **Forgotten password:** `dbAccounts` already is the reset port: `requestPasswordReset(email, now)` (the same answer whether or not the address has an account, the link mailed in the person's language) and `resetPassword(token, next, now)` (the token is stored hashed, used once, expires after `auth.passwordResetMinutes`, and every session ends). Put the product's limiter in front of both routes (`@krizaka/rate-limit`).

`sessionStoreContract` (from `@krizaka/auth/testkit`) is the contract every `SessionStore` adapter runs, memory and database alike.
