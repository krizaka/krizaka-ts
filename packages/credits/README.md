# @krizaka/credits

**One credits ledger for every Krizaka product.** It replaces three models: Yomizaka's `audit_credits` and `free_audit_used_at` columns on `accounts` (`reserveAudit` / `releaseAudit` / `refundFailedAudit`), Orochia's `wallet_ledger` with holds, and the Java kit's `credit_wallet` / `credit_ledger_entry` / `credit_hold` (`krizaka-billing`, whose names and events it follows). The coupons module (#46) grants capped credits through it.

> **The ledger is append-only and the balance is derived.** Nothing stores a balance that could drift: what is left of a pot is the sum of its lines. A database trigger refuses any `UPDATE` or `DELETE` of a line. Credits are integers, never floats.

```ts
import { emitMigration, transaction } from "@krizaka/db";
import { createCredits, creditsSchema } from "@krizaka/credits";
import { creditsSettings, readCreditsSettings } from "@krizaka/credits/settings";

emitMigration(creditsSchema, 1, { tables: { owner: "accounts" } }); // commit the SQL once, in your migrations

const credits = createCredits({ clock, settings: () => readCreditsSettings((key) => settings.get(key)), outbox });

await transaction(connect, async (tx) => {
  // a coupon's free credits: 20 audits, at most 5 a day, then stop; they lapse in 30 days
  await credits.grant(tx, { accountId, amount: 20, capPerDay: 5, expiresAt, onExhausted: "stop", source: `coupon:${redemptionId}`, idempotencyKey: `redeem-${redemptionId}` });
  // credits bought (the payment webhook, in the event's transaction)
  await credits.purchase(tx, { accountId, amount: 10, source: `purchase:${paymentRef}`, idempotencyKey: `pay-${paymentRef}` });
});

// spending: it refuses with a typed code, writes nothing when it refuses, and a replay of the key spends nothing more
const { draws } = await credits.consume(tx, { accountId, amount: 1, reason: `audit:${auditId}`, idempotencyKey: `audit-${auditId}` });
await credits.refund(tx, { accountId, consumed: `audit-${auditId}`, reason: "the run failed" }); // back to the same pots, once
```

## The model

- **Two kinds of pot.** A **granted** pot is free usage (a coupon, an allowance, a demo): it always **expires**, may be capped **per day** and **per month**, and says what happens when it runs out: `stop` or `fallback_paid`. A **purchased** pot does not expire and is never capped.
- **`consume(tx, { accountId, amount, reason, idempotencyKey })`** draws from the granted pots that **expire first**, each within its caps, then from purchased credits. Nothing is partial: it covers the whole amount or refuses.
  - past a pot's cap: `CREDITS_CAP_DAY` / `CREDITS_CAP_MONTH` (a fair-use limit: purchased credits do not bypass it; another granted pot still can serve);
  - a `stop` pot that is empty: `CREDITS_EXHAUSTED`, even if purchased credits exist;
  - a `fallback_paid` pot that is empty: it moves on to purchased credits, then answers `PAYWALL`;
  - no credits at all: `PAYWALL`.
  Refusals are `CreditsError`s with a `code` and the HTTP `status` a route may answer (402 / 429).
- **Holds.** `hold` keeps credits back for work in progress (it counts against the caps and the balance, and expires after `credits.holdTtlSeconds`); `settle(holdId, { amount? })` spends what the work cost (at most the hold) and frees the rest; `release` frees it all. Once each; a replay answers the first result.
- **`refund`** gives back what a consume (or a settled hold) spent, to the same pots, once. **`expire(grantId)`** writes off what is left of a pot (a revoked coupon: credits already spent are never taken back); **`expireDue`** sweeps the lapsed pots in a job. **`adjust`** is an administrator's signed correction, never below zero.
- **`balance`** is `{ total, granted, purchased, held, available, grants[] }`, derived; **`history`** pages the lines newest first.
- **Idempotency.** Every writing call takes a key; the lines of an operation are `<kind>.<key>:<n>` (unique in the database). Keys are unique per ledger, not per account: use an id (a payment ref, a job id). A key already used by **another account** is refused (`CREDITS_KEY_REUSED`). Keys carry no colon.
- **Concurrency.** Every writer takes `pg_advisory_xact_lock` on the account first, then reads and decides: concurrent consumption of the last credit never goes negative, a cap holds under load, and one key sent many times spends once (all proved on PostgreSQL, in loops).
- **Days and months** are cut by PostgreSQL in the admin's IANA zone (`credits.timeZone`, default `America/Toronto`), so daylight-saving shifts are the database's own tz data; « today » comes from the injected clock.
- **Events** (through `@krizaka/outbox`, in the caller's transaction, ids derived from the fact so each is announced once): `evt.credit.granted.v1` and `evt.credit.exhausted.v1`, the names of `krizaka-billing-api`, with a JSON Schema each (`CREDIT_EVENT_SCHEMAS`).
- **Settings** (`@krizaka/credits/settings`): `credits.timeZone` (a choice among the runtime's IANA zones) and `credits.holdTtlSeconds` (900, 30–86400).
- **Tables** (`creditsSchema`, Postgres schema `credits`): `grant`, `entry`, `hold`. The one product table it references is the owner (`owner`, the account table). An account that has credits is **anonymised, never deleted**: it is an accounting record, like an invoice.
- `creditsLedgerContract` (`@krizaka/credits/testkit`) is the contract every store runs; `memoryCreditStore()` is for unit tests (it has no transaction, so `lock` does nothing: concurrency is proved on PostgreSQL).

## Adopting it (Yomizaka)

`audit_credits` becomes a purchased pot (`purchase` once per account for the balance it has, key `import-<accountId>`), the free audit a granted pot with `onExhausted: "fallback_paid"`, `reserveAudit` a `consume` (a `PAYWALL` is already Yomizaka's 402), `releaseAudit` and `refundFailedAudit` a `refund` of the consume key.
