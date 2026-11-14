---
"@krizaka/docs": minor
---

New package `@krizaka/docs`: the user manual generated at build from the code (krizaka-internal#3644). A `manual.ts` beside each screen (`screen({ … })`, French and English) is read from the product's TypeScript program and checked against its route handlers, the input fields of its schemas, its error and settings catalogues and its e2e journeys; `buildManual` throws `ManualError` (`MANUAL_INCOMPLETE`) on any gap, and `manualDocuments` writes the pages for `DocsArticlePage` and `Markdown` of `@krizaka/ui`.
