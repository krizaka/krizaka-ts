---
"@krizaka/mail": minor
---

feat(mail): off production, mail goes only to the test allowlist, and a Mailpit provider. `mail.environment` (default `dev`; only `production` sends to anyone) and `mail.allowlist` (default `test@krizaka.com`, `bonjour@krizaka.com`): off production a recipient outside the list is refused before the provider is called, logged as `not-allowlisted` (hashed), and the subject gets `[test <environment>]`. New `mailpitProvider` (`MAIL_PROVIDER=mailpit`, base URL `mail.mailpitUrl`). `mailSchema` migration 2 adds the status: apply it before deploying. `MailSettings` gains `environment`, `allowlist` and `mailpitUrl`; a product that builds it by hand must set `environment: "production"` to keep sending to everyone.
