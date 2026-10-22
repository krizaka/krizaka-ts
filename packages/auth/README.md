# @krizaka/auth

The account of a Krizaka product, behind a port: a display name, language, theme and avatar seed; the e-mail change by a link mailed to the **new** address (the verified flag is set by that very act); the password (checked before anything sensitive, other sessions signed out on change); the live sessions with sign-out of the others; the data export; the deletion. Each product keeps its **own** accounts — the package brings an adapter over the product's PostgreSQL and the migration it needs, nothing central.

```ts
import { accountsMigration, postgresAccounts } from "@krizaka/auth";

await db.query(accountsMigration({ backfillVerified: true })); // once, in your migrations (idempotent)
const accounts = postgresAccounts({ query, mail, baseUrl: "https://www.akinaza.com", product: "Akinaza", tokenPrefix: "ae", passwords: { hash, verify }, tokenHash });
await accounts.updateProfile(id, { name: "Éric", theme: "dark" });
await accounts.sessions(id, new Date(), currentSessionId);
```

The product keeps what is its own: its session cookie and token hashing (`tokenHash`), its password hashing, its mailer, its rate limits and its HTTP answers (`AccountError` carries a status and a stable code). Time is passed in (`now`); nothing here reads the clock.
