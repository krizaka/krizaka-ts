---
"@krizaka/api-keys": patch
"@krizaka/architecture": patch
"@krizaka/audit": patch
"@krizaka/auth": patch
"@krizaka/brief": patch
"@krizaka/config": patch
"@krizaka/coupons": patch
"@krizaka/credits": patch
"@krizaka/docs": patch
"@krizaka/mail": patch
"@krizaka/notifications": patch
"@krizaka/org": patch
"@krizaka/organize": patch
"@krizaka/outbox": patch
"@krizaka/page-audit": patch
"@krizaka/payments": patch
"@krizaka/privacy": patch
"@krizaka/settings": patch
"@krizaka/sovkora-client": patch
"@krizaka/storage": patch
"@krizaka/webhooks": patch
---

SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.
