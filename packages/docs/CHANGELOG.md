# @krizaka/docs

## 0.1.1

### Patch Changes

- 79a6d53: SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.

## 0.1.0

### Minor Changes

- 547b2c9: New package `@krizaka/docs`: the user manual generated at build from the code (krizaka-internal#3644). A `manual.ts` beside each screen (`screen({ … })`, French and English) is read from the product's TypeScript program and checked against its route handlers, the input fields of its schemas, its error and settings catalogues and its e2e journeys; `buildManual` throws `ManualError` (`MANUAL_INCOMPLETE`) on any gap, and `manualDocuments` writes the pages for `DocsArticlePage` and `Markdown` of `@krizaka/ui`.
