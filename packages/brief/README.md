# @krizaka/brief

A Krizaka product's **weekly brief**: a few figured recommendations, each with **one action** — « You have 5 free slots
Thursday and Friday (450 $). 14 regulars have not booked for 6 weeks. [Invite them] ».

The product owns its data and its detectors; this block owns the contract, the guards, the ranking and the week.

```ts
import { composeBrief, isBriefDue, recommendation, weekOf } from "@krizaka/brief";

const { week } = weekOf(now, shop.timeZone);
const brief = composeBrief({
  week,
  ctx: snapshot,
  detectors: [gaps, pricing, taxProvision], // (ctx) => Recommendation[], pure
  guards: [{ name: "consent", check: (item, ctx) => (hasConsent(item, ctx) ? null : "NO_MARKETING_CONSENT") }],
}); // { items: top 3, vetoed: [{ item, guard, reason }], dropped }
```

- **Money is integer cents**; figures are named integers; the words are the product's messages (keyed by `kind`).
- `id` = `<week>:<kind>:<subject>`: the same data gives the same id, so an action is idempotent on it.
- Ranking: urgency (`now`, `week`, `info`), then impact, then id — total and stable.
- A guard (the falcon) vetoes with a reason; vetoed items are kept for the audit, never shown.
- `weekOf(instant, timeZone)` and `isBriefDue(instant, timeZone, lastSentWeek, { weekday: 1, hour: 7 })`: an hourly
  scheduler asks; a missed Monday still sends later in the week.
- No framework, no database, no environment, no wall clock.

Apache-2.0 · [Krizaka TS](https://github.com/krizaka/krizaka-ts)
