# @krizaka/brief

## 0.1.1

### Patch Changes

- 54ea159: The week reads the local calendar day from `@krizaka/intl`'s `localDay` and the hour from its cached `Intl` format, instead of a private `Intl.DateTimeFormat` (#77). Same results.

## 0.1.0

### Minor Changes

- b1946d7: New block: the weekly brief — recommendation contract (integer money, figures, evidence, assumptions), guards that veto with a reason, a deterministic top-three ranking, and the week in the shop's time zone (`weekOf`, `isBriefDue`). Refs #23.
