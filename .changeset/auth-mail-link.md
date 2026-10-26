---
"@krizaka/auth": minor
---

`Mail.link`: the password-reset and e-mail-change mails also hand their link to the product as data (`kind`, `url`, `minutes` or `hours`), so a product renders them with `@krizaka/email` (`passwordReset`, `emailChange`) instead of the plain text. Additive: `subject` and `text` are unchanged.
