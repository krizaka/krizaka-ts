# @krizaka/validate

The common facts every Krizaka app validates, written once: `isEmail`, `isHttpUrl`, `isSlug`, `isE164Phone`, `isCanadianPostalCode`. The `no-hand-written-validation-regex` rule of `@krizaka/config` refuses a hand-written pattern for these shapes and points here.

```ts
import { isEmail, isHttpUrl } from "@krizaka/validate";

if (!isEmail(input.email)) { /* 400 */ }
```

- A calendar date (`YYYY-MM-DD`) is `isIsoDate` of `@krizaka/time`.
- Each helper is a type guard on `unknown`, pure, no I/O. An email check says the shape is right, never that the mailbox exists.
- **Missing a fact?** Add it here first (with its test), never a regex in the app.
