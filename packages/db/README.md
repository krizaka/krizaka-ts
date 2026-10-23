# @krizaka/db

The database foundation of every Krizaka module ([ADR-001](../../docs/adr/ADR-001-modular-architecture.md)). It has **no database
client**: you pass your own connection (`pg`'s `Client` or `PoolClient` fits as it is).

- **The shared types:** `Query`, `Connection`, `Connect`, `Clock`.
- **`transaction(connect, work)`:** `BEGIN … COMMIT`, or `ROLLBACK` when the work throws.
- **Module schemas** (`defineModule`): each module's tables live in a Postgres schema named after it. Its versions are frozen and checksummed.
- **`emitMigration`** writes a module version into **your own** migration sequence, followed by a marker in `public.krizaka_module_versions`.
- **`adoptMigration`** adopts tables you already have: markers only, no DDL.
- **`assertModules`**, at boot, refuses a database that lacks a version the code needs.
- **`migrate`** is a runner for products without one: an advisory lock, a history table, one transaction per step.
- **`@krizaka/db/testing`:** `createTestDatabase`, `assertEmbedded` (your drift test) and `assertUpgrade`.

```bash
pnpm add @krizaka/db
```

## A module declares its schema

```ts
import { defineModule } from "@krizaka/db";

export const auditSchema = defineModule({
  module: "audit",                 // also its Postgres schema, unless the product renames it
  tables: ["owner"],               // the product tables it references, by role, and only those
  migrations: [
    { version: 1, name: "entries", sql: (c) => `CREATE TABLE ${c.schema}.entry (id bigserial PRIMARY KEY, actor_id uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL);` },
  ],                               // 1, 2, 3… in order; a released version never changes
});
```

## A product embeds it in its own sequence

```ts
import { emitMigration } from "@krizaka/db";
import { auditSchema } from "@krizaka/audit";

const context = { tables: { owner: "accounts" } };
// drizzle-kit: `drizzle-kit generate --custom --name=audit_1`, then write this text into the generated file.
// Your own list: append { version: "0031_audit_1", sql: emitMigration(auditSchema, 1, context) }.
process.stdout.write(emitMigration(auditSchema, 1, context));
```

Commit what it prints. Never generate it at runtime: the database changes only through your reviewed sequence.

- **Upgrading a module** is a package bump. Your drift test then names the version to add:

  ```ts
  import { assertEmbedded } from "@krizaka/db/testing";
  test("every module version is embedded", () => assertEmbedded(readMigrationFiles(), [{ schema: auditSchema, context }]));
  ```

- **At boot**, after your migrations: `await assertModules(query, [{ schema: auditSchema, context }])`.
- **Tables that already exist** (copied from a package before `@krizaka/db`): embed `adoptMigration(auditSchema, 1, context)` once. It writes the markers, and nothing is rebuilt.

## One use case, one transaction

```ts
import { transaction } from "@krizaka/db";

await transaction(() => pool.connect(), async (tx) => {
  await coupons.redeem(tx, input);
  await audit.record(tx, entry);   // both commit, or neither
});
```

## The runner, for products without one

```ts
import { migrate } from "@krizaka/db";
await migrate(() => pool.connect(), migrations, { lockKey: 73191 }); // history table `schema_migrations (version text)`, by default
```

## Tests on a real PostgreSQL

```ts
import { createTestDatabase } from "@krizaka/db/testing";

const db = await createTestDatabase({
  connect: async (database) => { const c = new pg.Client({ connectionString: urlOf(database) }); await c.connect(); return { query: (s, p) => c.query(s, p), release: () => c.end() }; },
  migrate: (connect) => migrate(connect, migrations, { lockKey: 1 }),
  prefix: "ak",
});
// … tests on db.name …
await db.drop();
```

- **No container and no network** beyond the server you point at (CI's service).
- **Errors** are `DbError`, with a stable `code` (`DB_MISSING_MODULES`, `DB_FROZEN_VERSION_CHANGED`, `DB_MODULE_ORDER`, `DB_UNSAFE_IDENTIFIER`…) and the items in `details`.
