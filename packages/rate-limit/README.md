# @krizaka/rate-limit

Limits per action for every Krizaka product: fixed windows per address and per subject, the limits read from the admin's settings, a memory store and a PostgreSQL store shared by every instance. It replaces the `rate-limit.ts` that Yomizaka, Akinaza and Kachizaka carried byte for byte, and the PostgreSQL variants of Orochia and Yasakia.

```ts
import { emitMigration } from "@krizaka/db";
import { createLimiter, dbLimitStore, rateLimitSchema, RateLimited } from "@krizaka/rate-limit";
import { limitsFromSettings, rateLimitSettings } from "@krizaka/rate-limit/settings";
import { clientIp } from "@krizaka/auth";

emitMigration(rateLimitSchema, 1, { tables: {} }); // commit the SQL once, in your migrations: table rate_limit.bucket

// the registry fragment: limits.signIn.perIp, limits.signIn.perSubject, limits.signIn.windowSeconds… the admin changes them without a redeploy
export const limitSettings = rateLimitSettings({ signIn: { perIp: 30, perSubject: 10, windowSeconds: 900 }, me: { perIp: 600, windowSeconds: 3600 } });

const limiter = createLimiter({
  store: dbLimitStore(query),                       // or memoryLimitStore() in one process and in tests
  clock: { now: () => new Date() },
  limits: limitsFromSettings((key) => settings.get(key)), // or a plain table: { signIn: { perIp: 30, perSubject: 10, windowSeconds: 900 } }
  onStoreError: (error, action) => log.error({ error, action }),
});

// in a route
await limiter.enforce("signIn", { ip: clientIp(req.headers, rules), subject: email }); // throws RateLimited: status 429, headers { "Retry-After" }
const verdict = await limiter.check("signIn", keys); // { ok: true } | { ok: false, retryAfterSeconds, scope: "ip" | "subject" }
await limiter.forget("signIn", keys); // a successful sign-in clears its failures
```

- **The semantics of the copies**, so their tests pass unchanged: a window starts at its first hit and lasts `windowSeconds`; a refused hit is counted too; the address is counted first and a refusal stops there; the subject is compared in lower case and counted only when the action has a `perSubject` limit and one is given; an unknown address is counted under `unknown`. The old call `limit("sign-in", req, email, [30, 900], [10, 900])` is `enforce("signIn", { ip, subject: email })` with `{ perIp: 30, perSubject: 10, windowSeconds: 900 }` in the settings.
- **The limiter takes keys, never a request.** The client's address is extracted by `clientIp` of `@krizaka/auth`; the package reads no header.
- **Limits are settings.** `rateLimitSettings` (`@krizaka/rate-limit/settings`, needs `@krizaka/settings` and `zod`) declares `limits.<action>.perIp`, `.perSubject` and `.windowSeconds` as integers with the product's defaults; `limitsFromSettings` reads them back at each check. An action id is letters and digits (`signIn`), because it sits in a settings key.
- **Stores:** `memoryLimitStore({ maxKeys })` keeps the copies' bound (10 000 windows; ended ones dropped first, then one shared overflow window, so a flood of keys limits itself and never clears a blocked caller's count). `dbLimitStore(query, { schema })` counts in **one atomic statement** (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), so 100 parallel checks count exactly and every instance sees the same counters; times come from the injected clock, not the database's. The table is `rate_limit.bucket (key, count, window_start, reset_at)`, one row per key (a deviation from `(key, window_start)` as primary key: with the first hit starting the window, two concurrent first hits would otherwise open two rows). `purge(now)` deletes the ended windows: call it from the product's job.
- **A store that fails lets the request through** (the limiter must not take the site down) and tells `onStoreError`; `failOpen: false` rethrows instead.
- **Orochia's extras** are in the port: `peek` (read without counting), `set` (a lock-out) and `reset`.
- `limitStoreContract` (from `@krizaka/rate-limit/testkit`) is the contract every store runs.

## Turnstile (`@krizaka/rate-limit/turnstile`)

A Cloudflare Turnstile widget protects nothing until the server asks Cloudflare about the token it produced. `createTurnstileVerifier({ secret, hostnames, now })` returns `verify({ token, remoteIp, action })` → `{ ok: true }` or `{ ok: false, reason, errorCodes }`. It **fails closed**: no secret (`not-configured`), no or oversized token (`missing-token`), a refusal (`rejected`), a token solved on another hostname or for another form's `action`, a replayed token (single-use, remembered for Cloudflare's 300 s), a timeout or an unreachable service (`unavailable`) all refuse. The secret is `ABUSE_CAPTCHA_SECRET_KEY` with `ABUSE_CAPTCHA_PROVIDER=turnstile` (the provider is a value; never in the browser); the site key is the public `NEXT_PUBLIC_ABUSE_CAPTCHA_SITE_KEY`. Answer a refusal with a 4xx and send nothing; log the `reason` only (no address, no message). Rule `turnstile-server-side` of the org registry.
