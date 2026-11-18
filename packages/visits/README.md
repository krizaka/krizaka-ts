# @krizaka/visits

A cookieless visit count for Krizaka's public sites. One row per **site, page, UTC day, referrer domain, utm_source and utm_campaign**, with a count.

**Never stored:** a cookie, an identifier, an address, a user agent, a query string (only the two utm values, as short slugs), a full referrer. The agent is read to refuse bots and thrown away.

```ts
import { dbVisitStore, recordVisit, weeklyVisits } from "@krizaka/visits";
import { visitsSchema } from "@krizaka/visits/schema"; // emitMigration(visitsSchema, 1 then 2, …) once, in the migrations

const store = dbVisitStore(query); // table visits.visit_counts (visitsSchema)
// in a request hook; never awaited on the page's critical path, never throws:
void recordVisit(store, { site: "www", path, referer, userAgent, utmSource, utmCampaign }, new Date(), {
  ownHosts: ["krizaka.com"],
  onError: log,
});
// the KPI report:
const reads = await weeklyVisits(query, "www", "2026-11-01"); // [{ week, page, count }]
```

- `normalisePath`: path only, lower case, no trailing slash; `null` for an API, an asset or a file.
- `referrerDomain`: the domain alone (no `www.`, no path, no port); empty for none or for the site itself.
- `utmValue`: a `utm_source` / `utm_campaign` value as a key: lower case, `a-z 0-9 _ . -`, at most 64 characters (`UTM_MAX_LENGTH`). Anything else is **rejected** (empty), never truncated, so a URL or an address can never become a key. Version 2 of the schema adds the two columns; apply it through the infra migration.
- `weeklyCampaignVisits`: weekly counts per campaign, source and page, for the reach dashboard.
- `isBot`: known crawlers and tools, and an empty agent.
- `DEFAULT_DAILY_ROW_CAP`: the most distinct (page, referrer, source, campaign) rows a site keeps per day; past it a new key is dropped, a known key still counts.
- `recordVisit` fails closed: a store error goes to `onError`, never to the page.
