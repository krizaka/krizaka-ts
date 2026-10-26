---
"@krizaka/brief": patch
---

The week reads the local calendar day from `@krizaka/intl`'s `localDay` and the hour from its cached `Intl` format, instead of a private `Intl.DateTimeFormat` (#77). Same results.
