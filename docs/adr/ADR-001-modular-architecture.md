# ADR-001: One modular architecture for every Krizaka product (business modules, their database, their cut)

- **Status:** accepted (2026-10-26). The CTO scheduled its delivery as block B46 (plan 2026-10-26) and its first modules are built on it: `@krizaka/db` (#50), `@krizaka/audit`, the six packages on `db` (#51), then the auth basics, rate limit, outbox and privacy (B47). If the CTO wants a point changed, it changes in a new ADR that supersedes this one.
- **Issue:** krizaka/krizaka-ts#47. It coordinates with #44 (storage, video), #46 (coupons), #34 (payments), #37/#38 (follows, reviews), #33 (orazaka-client) and #30 (functional names).
- **Builds on:** krizaka/.github ADR-006 (Krizaka TS and `@krizaka/organize`, PR krizaka/.github#197).
- **Evidence:** [`docs/design/module-map.md`](../design/module-map.md) holds the inventory with file:line, the module map and the cut.

## Context

Krizaka TS has six packages: `auth`, `settings`, `api-keys`, `webhooks`, `organize` and `brief`. Oussama asked « six, ça suffit ? ».
The inventory of seven products says no: the same capabilities are written again in each of them.

- **The database layer: six migration runners in five designs.**
  - Yomizaka (`apps/web/lib/db.ts:38-64`) and a former product (`lib/migrations.ts:84-110`) each have their own runner, with the same table name but a different column type (`text` and `int`).
  - Akinaza and a former product use drizzle-kit (`packages/db/src/migrate.ts`).
  - the former products use drizzle-kit files with their own runner (`packages/db/src/migrations.ts:1-68`).
  - Only Akinaza has a test database helper (`packages/db/src/test/db.ts:13-41`).
- **Byte-identical copies.**
  - `rate-limit.ts` is the same in Yomizaka, Akinaza and a former product.
  - `password.ts` is the same in four products, and `client-ip.ts` in four.
  - Akinaza and a former product also share `audit.ts`, `password-reset.ts` and the drizzle client.
- **Several copies of the same idea.**
  - Five `audit_log` tables.
  - Five outboxes.
  - Six mail senders. `@krizaka/email` (krizaka-ui) exists and is not used: Akinaza's `lib/mail.ts:12` waits for it.
  - Four storage implementations, behind two ports of the same shape.
  - Six partial Loi 25 export and erasure paths.
  - Three credit ledgers (Yomizaka's columns, a former product's `wallet_ledger`, Java's `credit_ledger_entry`).
- **A real collision.**
  - a former product has its own `app_settings` table (`packages/db/src/schema/recommendations.ts:49`), with versioned rows.
  - `@krizaka/settings` creates `app_settings` too (`packages/settings/src/migration.ts:7`), with another shape.
  - a former product cannot adopt the package without a namespace.
- **How package SQL reaches products today.**
  - Akinaza copies each package's SQL into its drizzle sequence with a generator and a drift test (`packages/db/src/gen-*-migration.ts`, `api-keys.test.ts:9-27`).
  - Yomizaka inlines the SQL into its migration list (`lib/migrations.ts:448-451`).
  - It works, but every product reinvents it.
- **The packages disagree on small things.**
  - `Query` returns `unknown[]` in `@krizaka/api-keys` (`persistence.ts:4`) but is generic in `settings` and `organize`.
  - Some packages inject a `Clock`; others take `now: Date`.
  - No package has a schema namespace or a version marker.
- **A gap in `@krizaka/payments`.** `applyOnce` records the event before the handler runs, and not in the same transaction (krizaka-ui `packages/payments/src/events.ts:15-21`). A handler that fails leaves an event marked as seen and never applied.
- **Server-side packages live in two repositories.** `@krizaka/payments`, `email`, `push` and `realtime` are server code in krizaka-ui. The Java side has the same capabilities as building blocks: `krizaka-users`, `krizaka-billing`, `krizaka-notifications`, and in the platform kit `app-config`, `persistence`, `messaging`, `idempotency`, `ratelimit` and `webhooks`.

## Decision

### 1. A module is one npm package with one fixed shape

Every business module is `@krizaka/<module>` in krizaka-ts. It follows ADR-006's rules: no product import, no environment variable, no vendor SDK, no ambient clock, no database client. Its files are named by function (#30):

```
packages/<module>/
  src/index.ts        the public API
  src/port.ts         the ports (Store, Provider, Events), the record types, the refusal codes (`as const`)
  src/<domain>.ts     the pure rules: data in, decision out, the clock injected (`coupons.ts`, `ledger.ts`)
  src/persistence.ts  the PostgreSQL store, over the `Query` of @krizaka/db
  src/memory.ts       an in-memory store (unit tests, demos)
  src/schema.ts       the module's schema: its Postgres schema name, its versioned migrations
  src/settings.ts     its settings: a registry fragment for @krizaka/settings (key, default, bounds, description)
  src/events.ts       the events it emits (`evt.<module>.<fact>.v1`) and their JSON Schema
  src/contract.ts     its HTTP contract: zod schemas, routes, refusal codes; browser-safe (`./contract`)
  src/admin.ts        its admin resource: list columns, filters, actions, read by @krizaka/ui; browser-safe (`./admin`)
  src/testkit.ts      the conformance kit that every adapter and every adopting product runs (`./testkit`)
test/                 tests mirror src/ (charter §5); an integration test against PostgreSQL where it stores
```

A module that has nothing for one of these files does not create it. The shape matters because it lets the docs site (`site/`), the admin and the conformance kits read every module the same way.

### 2. `@krizaka/db` is the foundation, and it holds no database client

`@krizaka/db` is the first module. It ships:
- **The shared types:** `Query` (generic, returning rows), `Database` (`query` + `transaction(work)`), `Clock` and `ModuleSchema`. Every module imports these instead of declaring its own.
- **`transaction(pool, work)`** over a minimal `Connection` interface (`query`, `release`). `pg`'s client satisfies it structurally, so the package never imports `pg`.
- **The module schema contract:** a module declares its Postgres schema, its `requires` (other modules) and an append-only list of versioned migrations. A migration is a function of the product's context (the owner table, the schema name), and `ident()` checks every identifier, as `organize/src/sql.ts` does today. A version's SQL is **frozen**: the package's own test fixes a checksum per version.
- **`emitMigration(module, version, context)`**. It writes the SQL that a product adds to **its own** sequence (§3), ending with a marker row in `public.krizaka_module_versions(module, version, checksum, applied_at)`.
- **`assertModules(db, modules)`**. A product calls it at boot; it fails with the list of the module versions the code needs and the database lacks.
- **A runner for products without one:**
  - one transaction per migration, under an advisory lock, with a history table;
  - it replaces Yomizaka's and a former product's copies;
  - drizzle-kit products keep drizzle-kit.
- **`@krizaka/db/testing`**:
  - `createTestDatabase({ connect, migrate, prefix })` creates a fresh `<prefix>_it_<hex>` database on the server the tests point at (CI's service, or a local one), migrates it and drops it. Both dependencies are injected, so the helper stays driver-free like the rest of the package:
    - `connect(databaseName)` returns a `Connection`. The helper calls it once on the administrative database (for `CREATE DATABASE` and `DROP DATABASE … WITH (FORCE)`) and once on the new one. The test passes a factory over its own `pg`.
    - `migrate(connection)` applies the product's full sequence, embedded module versions included (the product's runner, or `db`'s).

    This generalises Akinaza's helper (`packages/db/src/test/db.ts:13-41`); there is no Testcontainers dependency and no network beyond that server.
  - `assertEmbedded(productMigrations, modules)` is the product's drift test.
  - `assertUpgrade(from, to)` applies version N on top of version N-1 with sample rows.

### 3. The database question: one database per product, and one Postgres schema per module inside it

- **One database per product, as today.** No module is a runtime service. A product composes modules in its own database: ADR-006, and `@krizaka/auth`'s port, « every product keeps its own accounts ». It also keeps Loi 25 simple: one product's data, in one place, under one officer.
- **Each module's tables live in a Postgres schema named after the module** (`coupons.coupon`, `audit.entry`). The product may override the name, as Java's kit lets tables be renamed. Module code always qualifies its names and never relies on `search_path`. The product's own tables stay in `public`.
- **References between product tables and module tables:**
  - **A module may reference the product tables it declares as parameters, and only those.** The product names them in the migration context, and `ident()` checks each name. Three kinds exist today:
    - the owner (`ownerTable`: `apiKeysMigration`, `packages/api-keys/src/migration.ts:5`);
    - a scope (`rolesMigration`'s `scopeTable`, `packages/auth/src/migration.ts:36-38`);
    - declared entity tables (`organize`'s kinds: the tag join table references the entity, and the entity gains `collection_id`, `packages/organize/src/sql.ts:94-95`).

    A module never references a product table it did not declare. That keeps cut #2's « adopt with no DDL change » true for the existing packages.
  - **A product table may reference a module's row by id, with a real foreign key** (`REFERENCES coupons.redemption(id)`).
  - **A product never writes a module's table.** It calls the module's API, and reads through the module's store or a view the module ships.
- **The order is the product's.** Each module version is embedded in the product's single migration sequence: generated by `emitMigration`, committed, and guarded by `assertEmbedded`.
  - This is Akinaza's practice today, made standard.
  - One ordered history is the only order that satisfies both directions of foreign key (module → accounts, product → module) without deferred constraints.
  - drizzle-kit (`generate --custom`) and hand-run sequences both carry it.
- **The migration tool:**
  - **for module schemas:** `@krizaka/db`'s versioned SQL;
  - **for products:** drizzle-kit stays for Akinaza, the former products, and `@krizaka/db`'s runner serves Yomizaka, a former product and new products.
- **How a product upgrades a module's schema safely:**
  1. A module's minor version only **adds** (expand). A destructive change (contract) needs a major, and only after one release where the code read both shapes.
  2. Renovate/Dependabot bumps the package. The product's CI then fails on `assertEmbedded`, listing the missing versions.
  3. The developer runs `emitMigration`. CI applies the whole sequence on a fresh database, and runs `assertUpgrade` from the previous schema.
  4. The PR shows the SQL.
  5. The product's PRE_DEPLOY job (or its boot, as today) applies it, and `assertModules` refuses to serve on a database that lacks a version.
- **Existing tables are adopted, never rebuilt.**
  - The six packages' tables stay in `public` for now: `api_keys`, `app_settings`, `webhook_*`, `memberships`, `collections`…
  - A one-time **adopt** migration writes their markers.
  - Each package moves to its own schema in its next major, with `ALTER TABLE … SET SCHEMA` (a catalogue change, no data copy). `settings` moves first, because a former product's collision needs it.

### 4. The transaction question: one PostgreSQL transaction, the module's API inside it, events through the outbox

All modules of a product live in one database, so a use case that spans two modules is **one PostgreSQL transaction**:

```ts
await db.transaction(async (tx) => {
  const redemption = await coupons.redeem(tx, { code, accountId, paymentRef });  // locks the coupon row, counts the use
  await credits.grant(tx, { accountId, amount: redemption.credits, source: `coupon:${redemption.id}` });
  await audit.record(tx, { actor, action: "coupon.redeemed", target: redemption.id });
  await outbox.append(tx, couponRedeemed(redemption));                              // delivered after COMMIT
});
```

- A module function that can join a unit of work takes `tx` (a `Query`) as its first argument. Module services keep no pool of their own.
- A module never reads or writes another module's tables. It calls that module's API inside the same `tx`.
- Reactions in another module, or outside the database (mail, push, webhooks, Orazaka), go through the **outbox**: a row written in the same transaction, then delivered **at least once** by a leased worker (`FOR UPDATE SKIP LOCKED`, the pattern of a former product's `reco_outbox`). This replaces the five outboxes.
  - **What the lease guarantees:** an exclusive claim while the lease is valid.
  - **What it does not:** a worker that delivers and then crashes before marking the row done lets the lease expire, and another worker delivers again. Duplicates are possible after a crash.
  - **So every consumer is idempotent on the event id.** The outbox never promises « exactly once ».
- **Provider webhooks** (payments) record their idempotency key **in the same transaction as their effect**. This fixes `applyOnce`, and it is what « redeem never twice, never zero » requires.
- There are no sagas and no two-phase commit inside a product. Between products there is no shared transaction: they talk through signed webhooks (`@krizaka/webhooks`) or Orazaka runs.

### 5. Front and back: krizaka-ts serves, `@krizaka/ui` shows, the contract joins them

- **krizaka-ts (server):**
  - the domain, the ports, the adapters, the schema and the settings;
  - the **route handlers** as Web-standard factories (`(request) => Response`). A Next.js product mounts them in one line (`export const { GET, POST } = couponRoutes(deps)`). The product supplies only `authorize(request) → Actor | null` and its rate limiter, and stops copying routes.
- **`./contract` (browser-safe, zod only):** the request and response shapes, the routes and the typed refusal codes. The server handlers and the UI import the same file.
  - krizaka/krizaka-ui#551 (`GET /api/me` → 200 `{ signedIn, signupOpen, account? }`) is the first such contract. It belongs to `@krizaka/auth/contract`.
- **`@krizaka/ui` (screens):**
  - the admin screens are generic and read a module's `./admin` descriptor (a table, filters, actions, a detail view) over `@krizaka/query`;
  - the product-facing pieces are specific (the « Code promo » field, the notification bell, the consent dialog);
  - `@krizaka/ui` never imports server code.
  - A missing screen is a krizaka-ui issue, filed with the module's issue.
- **Where server packages live.** Server-side packages belong in krizaka-ts.
  - `@krizaka/payments` moves here (#34 already plans it), keeping its npm name and version line.
  - `email` stays in krizaka-ui (React Email templates), and the `mail` module adds its persistence, outbox and providers.
  - `push`, `realtime`, `app-config` and `discovery` stay where they are until a change touches them. Moving a package is a separate, reversible decision.

### 6. Java: the same names, the same boundaries, two runtimes

Where a capability exists in both runtimes, the TypeScript module and the Java building block carry the **same name and the same model**. The table in [`module-map.md` §4](../design/module-map.md#4-java-alignment) gives each pair. In short:
- `billing`/`credits` follow `krizaka-billing`'s ledger: `GRANTED` and `PURCHASED` buckets, holds, entry types `GRANT|PURCHASE|DEBIT|REFUND|EXPIRY|ADJUSTMENT`, an `idempotency_key` per entry (`70-billing.sql:145-184`).
- `auth` ↔ `krizaka-users`: the federation port is #32.
- `notifications` ↔ `krizaka-notifications`.
- `app-config` ↔ `krizaka-app-config` (its TypeScript twin, `@krizaka/app-config`, already exists in krizaka-ui).
- `webhooks` ↔ `krizaka-webhooks`.
- `rate-limit` ↔ `krizaka-ratelimit`.
- `outbox` ↔ `krizaka-messaging`, the only module that maps to it.
- `db` ↔ `krizaka-persistence`.
- Events use Java's routing-key form (`evt.credit.granted.v1`) and a JSON Schema per event, as `krizaka-billing-api` publishes them.
- The one divergence is stated: Java's kit keeps its own history table (`KrizakaMigrations.java:29`) because its tables reference nothing of the service's. TypeScript modules reference the product's accounts, so they embed in the product's sequence (§3).

### 7. The cut

The module map and the ordered issues are in [`module-map.md` §3 and §5](../design/module-map.md#5-the-cut-one-issue-one-pull-request). The order:
1. `db`
2. `audit`, which proves the shape on the smallest module
3. `outbox`
4. `rate-limit`
5. `payments` (moved here, events made transactional)
6. `credits`
7. `coupons` (#46)
8. `auth` basics (sessions, password, client IP, the `/api/me` contract)
9. `mail`
10. `privacy` (consent, export, erasure)
11. `storage` and `video` (#44)
12. `notifications`
13. `follows`/`reviews` (#37)
14. the admin descriptors

Each product adopts in a separate PR in that product, filed by the CTO.

## Rejected options

| Option | Why not |
|---|---|
| A runtime service per module (a « platform » the products call) | A network hop and an outage domain for every use case, one database for every product (Loi 25), and the end of « every product keeps its own accounts ». The Java side runs services because Orazaka is a distributed system. The TypeScript products are one app and one database each. |
| Tables prefixed in `public` (`coupons_coupon`) instead of a schema | It would work, and it is the runner-up. Ownership is weaker: no `\dn`, no `DROP SCHEMA` for a module, no grants per module. The prefix would be a convention a reviewer checks, where the schema is a boundary the database checks. The existing tables already mix prefixed and unprefixed names (`api_keys` and `memberships`). |
| A separate history table for module migrations, run before or after the product's (Java's `krizaka_schema_history` model) | Modules reference the product's account table and products reference module rows. With two histories, one direction of foreign key always fails on a fresh database unless constraints are deferred or added later. |
| drizzle-kit for modules (each module ships a drizzle schema) | It puts an ORM into generic packages (ADR-006 « no database client »). Every product snapshot would hold a copy of every module's schema. And Yomizaka and a former product do not use drizzle. |
| Each product keeps copying package SQL its own way (today) | It works, but the cost grows as modules × products. There are already two styles (Akinaza's generator, Yomizaka's inline list) and no runtime check that the database has what the code expects. |
| Polymorphic shared tables (`(kind, id)` columns) | ADR-006 already refused them: the database cannot check the reference. |
| Kysely, node-pg-migrate or Flyway-for-Node as the module migrator | Each one adds a tool and its history format, and none solves the ordering above. Frozen, versioned SQL strings are what the packages already ship (`*Migration()`). |

## Consequences and costs

- **One foundation to build first** (`@krizaka/db`, about one PR), then one PR per module. The six existing packages need a minor release each to use the shared types and declare their schema. Their tables move to their own schemas in a later major, one package at a time.
- **Products change in their own PRs:** Akinaza swaps its six generators for `emitMigration`; Yomizaka swaps its runner; the former products keep drizzle and add the embedded module versions. A migration the product already ran is adopted, never replayed.
- **Every module upgrade is a reviewed PR in each product.** This is deliberate: the database changes only through the product's sequence, and the SQL is visible. Renovate opens the PR; the drift test says what to add.
- **Discipline the reviews must hold:**
  - frozen versions;
  - additive minors;
  - qualified names;
  - no cross-module table access. The conformance kits and a dependency-cruiser rule (§1, ADR-006) check the last one.
- **What this ADR does not decide:**
  - whether a module ever becomes a Java/TS twin with a shared conformance suite (later, per module);
  - moving `push`, `realtime` and `app-config` out of krizaka-ui;
  - invoices, scheduling and customers, which stay in Akinaza until a second product needs them.
