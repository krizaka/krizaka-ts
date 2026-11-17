# @krizaka/visits

A cookieless visit count for Krizaka's public sites. One row per **site, page, UTC day and referrer domain**, with a count.

**Never stored:** a cookie, an identifier, an address, a user agent, a query string, a full referrer. The agent is read to refuse bots and thrown away.

```ts
import { dbVisitStore, recordVisit, weeklyVisits, visitsSchema } from "@krizaka/visits";

const store = dbVisitStore(query); // table visits.visit_counts (visitsSchema)
// in a request hook; never awaited on the page's critical path, never throws:
void recordVisit(store, { site: "www", path, referer, userAgent }, new Date(), {
  ownHosts: ["krizaka.com"],
  onError: log,
});
// the KPI report:
const reads = await weeklyVisits(query, "www", "2026-11-01"); // [{ week, page, count }]
```

- `normalisePath`: path only, lower case, no trailing slash; `null` for an API, an asset or a file.
- `referrerDomain`: the domain alone (no `www.`, no path, no port); empty for none or for the site itself.
- `isBot`: known crawlers and tools, and an empty agent.
- `DEFAULT_DAILY_ROW_CAP`: the most distinct (page, referrer) rows a site keeps per day; past it a new key is dropped, a known key still counts.
- `recordVisit` fails closed: a store error goes to `onError`, never to the page.
