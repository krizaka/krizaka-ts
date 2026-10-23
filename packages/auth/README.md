# @krizaka/auth

The account of a Krizaka product, behind a port: a display name, language, theme and avatar seed; the e-mail change by a link mailed to the **new** address (the verified flag is set by that very act); the password (checked before anything sensitive, other sessions signed out on change; reset by a link mailed to the account's address — the same answer whether or not the address has an account, the link used once within 30 minutes, every session signed out); the live sessions with sign-out of the others; the data export; the deletion. Each product keeps its **own** accounts — the package brings an adapter over the product's PostgreSQL and the migration it needs, nothing central.

```ts
import { accountsMigration, postgresAccounts } from "@krizaka/auth";

await db.query(accountsMigration({ backfillVerified: true })); // once, in your migrations (idempotent)
const accounts = postgresAccounts({ query, transaction, mail, baseUrl: "https://www.akinaza.com", product: "Akinaza", tokenPrefix: "ae", passwords: { hash, verify }, tokenHash }); // `transaction`: the work on one connection (BEGIN … COMMIT); the password reset needs it under concurrent requests
await accounts.updateProfile(id, { name: "Éric", theme: "dark" });
await accounts.sessions(id, new Date(), currentSessionId);
await accounts.requestPasswordReset(email, new Date()); // mails `<baseUrl>/<locale>/reset-password?token=…`
await accounts.resetPassword(token, newPassword, new Date()); // "CHANGED" | "INVALID"
```

The product keeps what is its own: its session cookie and token hashing (`tokenHash`), its password hashing, its mailer, its rate limits and its HTTP answers (`AccountError` carries a status and a stable code). Time is passed in (`now`); nothing here reads the clock.

## Roles per scope

A role model is data: `defineRoles({ roles, permissions, manages })` says which roles exist, what each may do and who may hand which role to whom. `createRoles` keeps memberships (one person, several scopes, a role in each) and invitations (an e-mail invited with a role, a link used once, only its hash kept, never demoting), refuses to remove or demote the last owner, and answers `authorize(account, scope, "invoices")` with the role or a stable refusal (`NOT_A_MEMBER` 404, `FORBIDDEN` 403). `rolesMigration(roles, { scopeTable })` makes the tables.
