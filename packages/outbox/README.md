# @krizaka/outbox

The transactional outbox of every Krizaka product. An event is **written in the caller's transaction**, so it exists exactly when the work committed, and is **delivered after the commit, at least once**, by workers that lease a batch. No broker: PostgreSQL and `FOR UPDATE SKIP LOCKED` share the work between instances. It replaces Akinaza's `mail_outbox` (whose `flushOutbox` nobody called) and the analytics outboxes the products carried; it is the TypeScript twin of `krizaka-messaging`'s `krizaka_outbox` (the envelope is `id`, `type`, `occurredAt`, `payload`).

> **The guarantee is *at least once*. Consumers must be idempotent on the message id.** A claim is exclusive while its lease is valid. A worker that delivers and then crashes before `complete` lets the lease expire, and the message is delivered **again**. The outbox never promises « exactly once ».

```ts
import { emitMigration, transaction } from "@krizaka/db";
import { consumeOnce, createOutbox, outboxSchema, runWorker } from "@krizaka/outbox";
import { readOutboxSettings } from "@krizaka/outbox/settings";

emitMigration(outboxSchema, 1, { tables: {} }); // commit the SQL once, in your migrations: outbox.message and outbox.processed

const outbox = createOutbox({ clock: { now: () => new Date() }, settings: () => readOutboxSettings((key) => settings.get(key)) });

// 1. in the use case: the message commits or rolls back with the work
await transaction(connect, async (tx) => {
  const redemption = await coupons.redeem(tx, { code, accountId });
  await outbox.append(tx, { topic: "credits", type: "evt.coupon.redeemed.v1", payload: { redemptionId: redemption.id }, id: redemption.eventId });
});

// 2. a worker the product starts (Next.js instrumentation.ts); the package has no timer, you pass `sleep`
const stop = new AbortController();
void runWorker({
  outbox, query: pool.query.bind(pool) /* a pool-level Query */, owner: `${hostname}:${process.pid}`, topic: "credits", signal: stop.signal,
  sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
  deliver: async (message) => { /* throw to retry */ },
});

// 3. a consumer with an effect in the database applies it once per message id, in the effect's transaction
await transaction(connect, (tx) => consumeOnce(tx, "credits", message.id, clock.now(), () => credits.grant(tx, …)));
```

- **`append(tx, { topic, type, payload, id?, availableAt? })`** takes the transaction's `Query` first. A given `id` makes the append idempotent (the same fact twice is one message). `type` is a routing key, `evt.<module>.<fact>.v1` like Java's.
- **`claim(query, { owner, topic? })`** is `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and sets the lease. **`complete`** and **`fail(error)`** act only for the lease's owner (a worker that lost its lease cannot overwrite the new holder). `fail` backs off — `availableAt = now + backoffSeconds × 2^(attempts−1)`, capped — and after `maxAttempts` the message is **dead** (kept, with its last error; `retryDead` gives it another life). A message whose *last* allowed attempt's lease expired with no answer is dead too, not delivered a ninth time.
- **`runWorker`** loops `drainOnce` (claim a batch, deliver in order, record each outcome), sleeps through the `sleep` you pass when a round found nothing, and ends when the signal is aborted. Run `drainOnce` from a scheduler instead if you prefer cron to a loop.
- **Settings** (`@krizaka/outbox/settings`, needs `@krizaka/settings` and `zod`): `outbox.batchSize` (50, 1–500), `outbox.leaseSeconds` (60, 10–3600: longer than your slowest delivery), `outbox.maxAttempts` (8, 1–50), `outbox.backoffSeconds` (30, 1–3600), `outbox.backoffMaxSeconds` (3600), `outbox.retentionDays` (7). `purge` removes delivered and dead messages older than the retention: call it from the product's job.
- **Tables** (`outboxSchema`, Postgres schema `outbox`): `message` (id, topic, event_type, payload, created_at, available_at, attempts, leased_until, lease_owner, delivered_at, dead_at, last_error) and `processed` (consumer, message_id), which `consumeOnce` uses: the marker and the effect commit in the same transaction, so a crash leaves neither and a redelivery finds the marker.
- `outboxStoreContract` (from `@krizaka/outbox/testkit`) is the contract every store runs; `memoryOutboxStore()` is for unit tests.
