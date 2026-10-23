# @krizaka/audit

**Who did what, for every Krizaka product.** The trail is append-only and lives in the product's database, in the Postgres schema `audit`.
- **Two ways to write:** inside the caller's transaction (it commits or rolls back with the work), or quietly beside it (a failure is logged, never thrown).
- **For the admin:** filtered and paginated.
- **For Loi 25:** exported and redacted.
- **Retention:** purged after a retention the admin sets.

There is no database client and no wall clock: you pass a `Query` and a `Clock`.

```bash
pnpm add @krizaka/audit @krizaka/db
```

## Add its schema to your migrations

The schema is embedded through `@krizaka/db`, in your own sequence:

```ts
import { emitMigration } from "@krizaka/db";
import { auditSchema } from "@krizaka/audit";

// commit the output as one of your migrations (drizzle-kit `generate --custom`, or your list)
emitMigration(auditSchema, 1, { tables: { owner: "accounts" } });
```

The table is `audit.entry`. It holds the time, the actor (references your `accounts`, `ON DELETE SET NULL`), a readable label, the dotted action (`billing.checkout_started`), an optional target, the detail (jsonb) and the IP.

## Use

```ts
import { createAudit } from "@krizaka/audit";
import { transaction } from "@krizaka/db";

const audit = createAudit({ clock: { now: () => new Date() }, onError: (e) => logger.warn(e) });

// Inside a unit of work: the entry exists only if the work commits.
await transaction(connect, async (tx) => {
  await suspendUser(tx, userId);
  await audit.record(tx, { actorId: admin.id, actorLabel: admin.name, action: "admin.user_suspended", target: { type: "account", id: userId } });
});

// Beside it: never fails the request.
await audit.recordQuietly(query, { actorId: null, actorLabel: "stripe webhook", action: "billing.event_ignored", detail: { type } });

// The admin's view: newest first, filtered, paged by cursor.
const page = await audit.list(query, { actionPrefix: "admin.", limit: 50 });
const next = await audit.list(query, { actionPrefix: "admin.", limit: 50, before: page.at(-1)?.id });
```

- **Loi 25:**
  - `exportFor(query, accountId)` gives the person's entries;
  - `redactActor(tx, accountId)` keeps the facts and removes the person: the id and IP become null, and the label becomes « erased ».

  Put as little personal data in `detail` as the action needs.
- **Retention:** register `auditSettings` in your `@krizaka/settings` registry (`audit.retentionDays`: default 1095, 30–3650 days). Your job then calls `audit.purge(tx, { retentionDays })`.
- **Input from a request is checked the same way for every store:** a page size must be a positive integer (capped at 200), a cursor must be an entry id, an IP must be an address, and a retention must be within the setting's bounds (30–3650 days), so a bad value never purges the whole trail. Each refusal is an `AuditError` with a stable code (`AUDIT_BAD_FILTER`, `AUDIT_BAD_IP`, `AUDIT_BAD_RETENTION`…).
- **A fixed list of actions:** `createAudit({ allowedActions: [...] })` refuses anything else (`AUDIT_UNKNOWN_ACTION`).
- **Another store** runs the contract kit: `auditStoreContract` from `@krizaka/audit/testkit`. `memoryAuditStore()` is the reference.
