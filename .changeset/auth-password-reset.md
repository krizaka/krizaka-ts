---
"@krizaka/auth": minor
---

Password reset by a mailed link: `requestPasswordReset` (the same answer whether or not the address has an account; a new request retires the earlier link), `resetPassword` (single use, 30 minutes, the new password checked before the link is used up, every session signed out), `passwordResetMail` (FR/EN), `linkToken` / `isLinkToken` (one format for every mailed link), and the `password_resets` table in `accountsMigration` (idempotent).
