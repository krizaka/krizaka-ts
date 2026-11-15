---
"@krizaka/org": minor
---

Every site carries its bird, tone and description in the org JSON (krizaka-internal#3785). `OrgSite` gains `kind`, `mascot { bird, tone }`, `description` (FR/EN) and `aliases`; `sites` now lists the four products' sites too. One id per site across `sites`, `family` and `footer.sites` (`krizaka`, `lab`); the old ids `www` and `motion` stay as `aliases`, deprecated until 1.9.0. `footer.sites.rust` is removed: no such site exists. The Java description no longer names Maven Central.
