---
"@krizaka/org": minor
---

One closed set for a product's status, `PRODUCT_STATUS` (`design`, `upcoming`, `construction`, `development`, `paused`, `devPreview`), in the type, the JSON Schema and the exports, so a site reads it from `org.json` instead of typing its own (krizaka-internal#3425). Schema stays at 2 (a wider enum; the data still uses `development` for Sovkora, Verikora and Folioviv, whose pause is lifted).
