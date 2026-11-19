---
"@krizaka/config": minor
---

`krizaka-export-guard <dir> --product <id>` (and `@krizaka/config/export-guard`): refuses a product's public static export that carries a sign-in link, a `dev.` host, a retired code name, an e-mail outside `/privacy`, an amount outside the allowed list, « Bientôt » / « Soon » on an offer, a licence name other than the repo's, or a status different from `@krizaka/org` (krizaka-internal#4148).
