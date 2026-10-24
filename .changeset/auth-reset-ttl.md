---
"@krizaka/auth": minor
---

The password reset link's lifetime is configurable: `AccountDeps.passwordResetTtlMinutes` (a whole number from 5 to 1440, default 30 — `PASSWORD_RESET_TTL_MINUTES`, now only the default; out of range, `postgresAccounts` throws). The expiry and the mailed text (`passwordResetMail(product, locale, url, ttlMinutes?)`, FR and EN) both use it. `PASSWORD_RESET_MIN_MINUTES` and `PASSWORD_RESET_MAX_MINUTES` are exported.
