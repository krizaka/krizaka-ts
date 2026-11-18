# @krizaka/visits

## 0.2.0

### Minor Changes

- e59371d: Schema v2 keeps `utm_source` and `utm_campaign` as counts: `VisitInput` gains `utmSource` and `utmCampaign`, read through `utmValue` (lower case, `a-z 0-9 _ . -`, at most 64 characters, rejected otherwise, never the full URL); the aggregate key and the daily row cap include them; `weeklyCampaignVisits` reads them. Apply migration 2 of `visitsSchema` before deploying.

## 0.1.0

### Minor Changes

- 2edde6c: New: a cookieless visit count. Path and referrer-domain normalisation, a bot filter, a daily row cap, a fail-closed `recordVisit`, the `visit_counts` table and a weekly read per page (krizaka-internal#4122).
