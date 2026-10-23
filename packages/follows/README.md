# @krizaka/follows

Follow any typed target with idempotent subscriptions, per-channel notification preferences, mute, paginated follower lists and counts. Products own their identities and authorization; the package has no framework, database client or ambient clock.

```ts
import { createFollows, followsMigration, pgFollowStore } from "@krizaka/follows";

await db.query(followsMigration());
const follows = createFollows({ store: pgFollowStore(query), clock: { now: () => new Date() } });
const target = { targetType: "shop", targetId: shopId };
await follows.follow(customerId, target);
await follows.updatePreferences(customerId, target, { email: true, push: false, inApp: true });
await follows.mute(customerId, target);
const subscribers = await follows.followers(target, { offset: 0, limit: 20 });
const total = await follows.count(target);
```

The in-memory store is `memoryFollowStore()`. Every adapter can run `followStoreContract` from `@krizaka/follows/testkit`. The PostgreSQL adapter accepts the product's query function; it does not import a driver.
