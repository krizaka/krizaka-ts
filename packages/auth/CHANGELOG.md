# @krizaka/auth

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
