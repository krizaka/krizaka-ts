# @krizaka/time

Date arithmetic for every Krizaka backend, in one place. The « Krizaka first » dates rule (`@krizaka/config`) refuses a date library inside a package; this is the facade it points to, so `addSeconds`, `addHours`, `differenceInSeconds` and `isBefore` are written once and the library behind them can change without touching a package.

```ts
import { addSeconds, differenceInSeconds, isBefore } from "@krizaka/time";

const resetAt = addSeconds(clock.now(), 900);
if (isBefore(resetAt, clock.now())) { /* ended */ }
const retryAfter = differenceInSeconds(resetAt, clock.now());
```

- **Exact on the instant.** Adding two hours adds 7 200 000 ms whatever the server's time zone, so « a session of 14 days » is `addHours(now, 14 * 24)` and lasts the same on every server, across a daylight-saving change.
- **Not the calendar.** The day a law, a deadline or a receipt means, in a person's zone, is not arithmetic on an instant: use `localDay` of `@krizaka/intl`. For that reason there is no `addDays` here.
- **Missing function?** Add it here first (with its test), never import the library beside it.
- Pure: no clock of its own (take a `Clock` from `@krizaka/db`), no environment, no I/O.
