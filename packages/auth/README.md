# @krizaka/auth

The account of a Krizaka product, behind a port: a display name, language, theme and avatar seed; the e-mail change by a link mailed to the **new** address (the verified flag is set by that very act); the password (checked before anything sensitive, other sessions signed out on change; reset by a link mailed to the account's address — the same answer whether or not the address has an account, the link used once within 30 minutes by default — `passwordResetTtlMinutes`, 5 to 1440, read by the product from its settings and said in the mail — every session signed out); the live sessions with sign-out of the others; the data export; the deletion. Each product keeps its **own** accounts — the package brings an adapter over the product's PostgreSQL and the migration it needs, nothing central.

```ts
import { accountsMigration, postgresAccounts } from "@krizaka/auth";

await db.query(accountsMigration({ backfillVerified: true })); // once, in your migrations (idempotent)
const accounts = postgresAccounts({ query, transaction, mail, baseUrl: "https://www.akinaza.com", product: "Akinaza", tokenPrefix: "ae", passwords: { hash, verify }, tokenHash, passwordResetTtlMinutes: 30 /* optional, 5–1440 */ }); // `transaction`: the work on one connection (BEGIN … COMMIT); the password reset needs it under concurrent requests
await accounts.updateProfile(id, { name: "Éric", theme: "dark" });
await accounts.sessions(id, new Date(), currentSessionId);
await accounts.requestPasswordReset(email, new Date()); // mails `<baseUrl>/<locale>/reset-password?token=…`
await accounts.resetPassword(token, newPassword, new Date()); // "CHANGED" | "INVALID"
```

The product keeps what is its own: its session cookie and token hashing (`tokenHash`), its password hashing, its mailer, its rate limits and its HTTP answers (`AccountError` carries a status and a stable code). Time is passed in (`now`); nothing here reads the clock.

## Roles per scope

A role model is data: `defineRoles({ roles, permissions, manages })` says which roles exist, what each may do and who may hand which role to whom. `createRoles` keeps memberships (one person, several scopes, a role in each) and invitations (an e-mail invited with a role, a link used once, only its hash kept, never demoting), refuses to remove or demote the last owner, and answers `authorize(account, scope, "invoices")` with the role or a stable refusal (`NOT_A_MEMBER` 404, `FORBIDDEN` 403). `rolesMigration(roles, { scopeTable })` makes the tables.

## Federated sign-in (Google, Apple, Facebook, native PKCE)

Each product keeps its own accounts; **krizaka-users** is the federation provider behind a port, so a product holds no OAuth app of its own. `IdentityProvider` has two calls: `start(provider, returnTo, { codeChallenge? })` gives the address to send the person to, `complete(code, { codeVerifier? })` exchanges the one-time code (single use) for a verified `ExternalIdentity` (`issuer`, `subject`, `email`, `emailVerified`). A return address stays on the product (a path); an unknown provider is refused.

```ts
import { createFederatedSignIn, dbIdentityLinks, identityLinksMigration, usersIdentityProvider } from "@krizaka/auth";

await db.query(identityLinksMigration()); // once, in your migrations (idempotent): (issuer, subject) → account
const federation = usersIdentityProvider({ baseUrl: "https://auth.dev.akinaza.com", appUrl: "https://dev.akinaza.com", fetch });
const signIn = createFederatedSignIn({ links: dbIdentityLinks(query), accounts: { findByEmail, create }, clock });

const { url } = await federation.start("google", "/fr/account"); // redirect there
const result = await signIn.signIn(await federation.complete(code)); // { status: "signed-in", accountId, via } | { status: "refused", code }
```

An external identity attaches to an existing account **only when the address is verified on both sides** (by the provider and by the product); otherwise it is refused (`EMAIL_NOT_VERIFIED`, `ACCOUNT_EMAIL_UNVERIFIED`), and it is never a second user table. `create` is optional: leave it out and a person without an account is refused (`NO_ACCOUNT`). Adapters run the conformance kits of `@krizaka/auth/testkit` (`identityProviderContract`, `identityLinkStoreContract`).
