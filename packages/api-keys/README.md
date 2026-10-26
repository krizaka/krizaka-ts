# @krizaka/api-keys

API keys for every Krizaka product. A key is `<prefix>_<publicId>_<random>`: the public id finds the record, only a SHA-256 of the random
part is stored, the whole key is shown **once** (when it is created or rotated), scopes and rules are data, a key must end, a rotated key
keeps working for a grace period, a revoked one stops at once, and every refusal has a stable code.

```ts
import { emitMigration } from "@krizaka/db";
import { apiKeysSchema, createApiKeys, dbApiKeyStore } from "@krizaka/api-keys";

emitMigration(apiKeysSchema, 1, { tables: { owner: "accounts" } }); // commit the SQL once, in your migrations
const keys = createApiKeys({ store: dbApiKeyStore(query), clock: { now: () => new Date() }, rules: { prefix: "yzk", scopes: ["checks:write", "reports:read"], secretBytes: 24, maxExpiryDays: 365, rotationGraceHours: 24, lastUsedEveryMinutes: 5 } });

const { key } = await keys.create(owner, { name: "Mon ERP", scopes: ["checks:write"], expiresInDays: 90 }, { maxActive: 5 });
const auth = await keys.authenticate(request.headers.get("authorization"), "checks:write"); // { ok: true, key } | { ok: false, code }
```

**Schema.** The tables are a `@krizaka/db` module (`api_keys`), version 1 byte-identical to the SQL this package shipped before, so a product that has them adopts with no DDL change: `adoptMigration(apiKeysSchema, 1, context)` writes the marker only, `emitMigration(…)` writes the SQL for a database that lacks them. The old migration function stays, `@deprecated`, for one minor.
What a product decides stays in the product: its scopes, how many keys a plan holds (`maxActive`), its rate limit, its audit trail, its HTTP answers.
Any store runs the contract kit: `apiKeyStoreContract` from `@krizaka/api-keys/testkit`.

> `pgApiKeyStore` was the first name of `dbApiKeyStore`; it stays as a `@deprecated` alias for one minor and leaves in the next major.
