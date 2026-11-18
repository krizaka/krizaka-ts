---
"@krizaka/visits": minor
---

Schema v2 keeps `utm_source` and `utm_campaign` as counts: `VisitInput` gains `utmSource` and `utmCampaign`, read through `utmValue` (lower case, `a-z 0-9 _ . -`, at most 64 characters, rejected otherwise, never the full URL); the aggregate key and the daily row cap include them; `weeklyCampaignVisits` reads them. Apply migration 2 of `visitsSchema` before deploying.
