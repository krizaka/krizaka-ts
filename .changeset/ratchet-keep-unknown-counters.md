---
"@krizaka/config": patch
---

`krizaka-ratchet --update` keeps the counters of the file it does not measure (a repository's own, e.g. `pageTemplate`) as recorded instead of dropping them silently, and names them in its report. It still never raises a count (krizaka/.github#319).
