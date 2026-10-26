# The module map: what exists, what each module is, in which order it comes

This is the evidence and the plan of [ADR-001](../adr/ADR-001-modular-architecture.md), for krizaka/krizaka-ts#47.
- **Sources:** a read-only pass over `main` on 2026-10-23, at these commits:
  - yomizaka `7b77d2e`, akinaza `86d35a2`, kachizaka `9df64cb`, orochia `239e402`, yasakia `7d34595`, yororis `6a06067`;
  - orazaka-web-client, plus the Java repositories it calls.
- **Path notation:** paths are relative to each repository. `Y` = yomizaka, `A` = akinaza, `K` = kachizaka, `O` = orochia, `S` = yasakia, `R` = yororis, `W` = orazaka-web-client.

## 1. The inventory: capabilities × products

### 1.1 The database layer

| Product | Driver / ORM | Migration tool and runner | Test database | Transactions |
|---|---|---|---|---|
| Y | raw `pg`, pool of 5 on `globalThis` (`apps/web/lib/db.ts:10-35`) | own runner: `pg_advisory_lock(73191)`, `schema_migrations(version text)`, one tx each (`lib/db.ts:38-64`); SQL strings in `lib/migrations.ts` (0001–0026, no 0018); runs at server start (`instrumentation.ts:13-14`) | env-gated (`YOMIZAKA_DB_IT=1`), real PG, no isolation (`lib/db.integration.test.ts:18-20`) | none outside migrations; atomic `UPDATE … RETURNING` (`lib/billing.ts:56-57`) |
| A | drizzle `node-postgres` (`packages/db/src/client.ts:13-23`) | drizzle-kit `generate` + drizzle `migrate` under `pg_advisory_lock(73193)` (`packages/db/src/migrate.ts:11-20`) on `DATABASE_DIRECT_URL`; 30 journal entries, snapshots only for 0000–0001 | Testcontainers or CI's PG, one `ak_it_<hex>` database per test file (`packages/db/src/test/db.ts:13-41`) | `db.transaction` (`Tx`, `client.ts:7`) |
| K | copy of A (`client.ts` byte-identical) | same, lock 73192 | copy of A without `freshEmptyDatabase` | same |
| O | drizzle-orm 0.45 + `pg` (`packages/db/src/client.ts:14,146`) | drizzle-kit files applied by its own runner, all pending in one tx (`packages/db/src/migrations.ts:1-68`), bundled as `migrate.cjs`, DigitalOcean PRE_DEPLOY (`migrate.ts:1-45`) | not found; env-gated tests on `DATABASE_URL` | ~47 `.transaction(` sites |
| S | drizzle 0.45 + `pg` | adapted copy of O's runner (`packages/db/src/migrations.ts:1-9`), PRE_DEPLOY | not found; env-gated | drizzle |
| R | raw `pg` (`apps/web/lib/db.ts:7-27`) | own runner: lock 7411001, `schema_migrations(version int)` (`lib/migrations.ts:84-110`) | `search_path` schema on `TEST_DATABASE_URL` (`tests/accounts-script.test.mjs:10-18`) | none |
| W | no database (two catch-all proxy routes, `src/app/api/v1/[...path]/route.ts:15-61`) | Java: initdb SQL + dated scripts (`krizaka-billing/infra/initdb/70-billing.sql`); Flyway only in `krizaka-persistence` (`KrizakaMigrations.java:75-86`) | Java Testcontainers ITs | JDBC |

**How the krizaka-ts packages reach a product's database today:**
- **Akinaza:** one generator per package (`packages/db/src/gen-{account,api-keys,organize,roles,settings,webhooks}-migration.ts`) prints the package's SQL into a committed `drizzle/00NN_*.sql`. A drift test checks it (`api-keys.test.ts:9-27`, `organize.test.ts:26`).
- **Yomizaka:** it calls the function inside its list (`lib/migrations.ts:448-451`, `accountsMigration()` as 0023).

### 1.2 Every other capability

| Capability | Y | A | K | O | S | R | W → Java |
|---|---|---|---|---|---|---|---|
| audit | `audit_log` (`lib/migrations.ts:83-93`), writer `lib/audit.ts:5-18`, ~51 call sites | `audit_log` (0000), `lib/audit.ts:5-18` | byte-identical to A | console DB only, `admin_audit` (`apps/web/console/lib/db.ts:3-37`) | `audit_log`, fixed `AUDIT_ACTIONS` (`lib/audit.ts:6-55`) | in-memory (`lib/store.ts:54-74`) | `admin_audit` (`krizaka-users/infra/initdb/10-identity.sql:134`), `operator_audit` (`70-billing.sql:687`) |
| mail | Mailgun, plain text, FR/EN inline (`lib/mailer.ts:1-27`, `lib/signup.ts:42-46`) | Mailgun + `mail_outbox` (0003) + template files (`lib/mail.ts:15-138`, `lib/mail-templates.ts:16-35`); `flushOutbox` has no caller outside tests (`lib/mail.ts:49`) | templates only (`lib/mail-templates.ts:16-29`) | Resend or Mailgun + template files (`lib/mail.ts:4-60`, `lib/mail-templates.ts:6-50`) | Mailgun, O's template format (`lib/mail.ts:7-28`) | Mailgun copy (`lib/mail.ts:15-30`) | SMTP/SMS/webhook, AMQP (`krizaka-notifications-service`) |
| notifications | — | e-mail only | — | bell + SSE + push + e-mail with burst caps (`lib/notifications.ts:17-24`), matrix 5 × 2 (`lib/notification-matrix.ts:3-15`), `@krizaka/push` (`lib/push.ts:1-24`) | `pushToAccount` (`lib/push.ts:1-42`), no caller | — | toasts only (W); Java notifications |
| storage | port `put/get/delete` (`lib/storage/port.ts:27-34`); Bunny, S3 (own SigV4), memory, encrypted (`lib/storage/config.ts:34-59`) | Bunny over `fetch`, no port (`lib/media-upload.ts:9-108`) | — | fs or Bunny, no port (`lib/storage.ts:17-25`); Bunny Stream (`packages/media/src/bunny-client.ts:22`) | `MediaStorage` port, Bunny/local/memory (`packages/media/src/storage.ts:9,34,61,90`) | — | conversation service (`AssetController.java:32`) |
| payments | `@krizaka/payments` 0.1.0 (Stripe), local `config.ts`, `billing.ts`, 3 routes | same, founder price (`lib/payments/config.ts:12-21`) | — | own `@orochia/payments`, 5 gateways (`packages/payments/src/types.ts:3,49-56`) | — | — | `krizaka-billing`, no payment provider (`PackSubscriptionService.java:30-33`) |
| credits / quota | `audit_credits`, `free_audit_used_at` on `accounts` (0009), `reserveAudit` (`lib/billing.ts:46-74`), caps from settings (`lib/settings/boundary.ts:55-65`) | plan limits in settings (`lib/settings.ts:21-35`) | — | `wallet_ledger` (`schema/wallet.ts:32-51`), advisory lock per wallet (`packages/payments/src/credits.ts:95`) | — | `moment_starts` (`lib/starts.ts:4-11`) | `credit_ledger_entry`, `credit_hold` (`70-billing.sql:145,184`) |
| jobs / outbox | — (« advance while looked at », `lib/batch/run.ts:14-20`) | `setInterval` (`instrumentation.ts:5-27`) | GitHub cron (`.github/workflows/dev-sync.yml:9-10`) | `setInterval` schedulers (`instrumentation.ts:1-15`), `reco_outbox` with SKIP LOCKED (`lib/recommendations/recommendations.outbox.ts:14-19`) | `setInterval` (`lib/jobs.ts:36-77`), `analytics_outbox` | — | `billing_outbox` (`70-billing.sql:298`), `krizaka_outbox` (`krizaka-messaging`) |
| consent / export / erasure | `consents` (`lib/migrations.ts:180-187`), `api/me/export`, `api/me/delete`, retention (`lib/retention.ts`) | `recordConsent`/`eraseClient` (`packages/db/src/shop-ops.ts:75,85`), `api/me/export`, privacy officer tested (`lib/privacy-officer.test.ts`) | admin only (`lib/admin.ts:124,159`) | admin export only (`lib/account-export.ts:1-4`) | async export (`lib/export.ts:28-42`), deletions (`lib/admin-erase.ts:10-16`) | consent columns (`app/api/me/consent/route.ts:8-23`) | admin export/erase (`AdminUserController.java:88,94`) |
| settings / flags | `@krizaka/settings` (`lib/settings/registry.ts:30-48`) | `@krizaka/settings` (`lib/settings.ts:10-37`) | env | own `app_settings` (`schema/recommendations.ts:49`), `app_config` (0017) | `rule_sets` (`lib/rule-sets.ts:12-39`), `app_config` (0006) | env | `billing_runtime_config` (`70-billing.sql:328`) |
| rate limit | in-memory fixed window (`lib/rate-limit.ts:8-47`) | byte-identical | byte-identical | memory or PG `rate_limit_buckets` (`lib/rate-limit.ts:8-118`) | same design as O (`lib/rate-limit.ts:7-53`) | simpler variant (`lib/rate-limit.ts:1-19`) | edge `ApiKeyRateLimiter`, `krizaka-ratelimit` |
| accounts / sessions | `@krizaka/auth` + own `ys1.` sessions (`lib/session.ts:13-62`) | `@krizaka/auth` + `as1.` sessions (`lib/session.ts:11-55`), roles (`packages/db/src/roles.ts:9-27`) | own `ks1.` sessions, no package | own HMAC cookie (`lib/auth.ts:7-29`), OAuth | e-mail code + `web_sessions` (`lib/web-session.ts:8-17`) | `access_tokens` (`lib/access.ts:12-39`) | `krizaka-users` (`AuthController.java`) |
| password, client IP | `password.ts`: byte-identical in Y, A, K, R; `client-ip.ts`: byte-identical in Y, A, K, S, variant in O | | | | | | |
| admin gate | ADMIN role + `AUTH_ALLOWED_IPS` + admin host (`lib/access.ts:12-19`, `proxy.ts:13-27`) | ADMIN + IP list (`lib/access.ts:48-53`) | `lib/access.ts:40` | separate console DB + IP list (`console/lib/gate.ts:10-16`) | session + ADMIN + IP list (`lib/console-access.ts:12-39`) | ADMIN (`lib/http.ts:17-21`) | `ROLE_ADMIN` (`src/console/core/auth/auth-options.ts:20,56`) |
| search | tsvector + GIN (`lib/search.ts:5-25`) | not found | — | tsvector en+fr unaccent (`lib/search.ts:3-43`), embeddings (`lib/explore-semantic.ts`) | pgvector for matching | — | conversation service |
| follows / reviews | — | flags only (`lib/settings.ts:18-19`) | — | `follows`, likes, comments (`schema/contacts.ts`, `schema/engagement.ts`) | — | — | — |
| invoices | Stripe portal | numbering, TPS/TVQ, credit notes (`packages/db/src/shop-ops.ts:15-235`, `packages/core/src/tax.ts:8-88`) | — | payouts (`packages/payments/src/ledger.ts:179-218`) | — | — | — |
| scheduling | — | schedules, appointments with an exclusion constraint, bookings, days off (`schema.ts:314-551`, 0001, 0003) | matches, rounds | auction closing (`lib/auction-scheduler.ts:5-26`) | batch windows (`lib/jobs.ts:17-21`) | — | automation service |
| customers | `payment_customer_id` only | `clients`, consents, dependants (`schema.ts:330-647`) | — | contacts (social) | — | — | — |
| API keys, webhooks, realtime | `@krizaka/api-keys` | `@krizaka/api-keys`, `@krizaka/webhooks`, `@krizaka/realtime` | `@krizaka/realtime` | `@krizaka/realtime` | `@krizaka/realtime` | — | `krizaka-users` keys, Studio webhooks |

### 1.3 Server-side packages that already exist

| Package | Repository | What it is | Used by |
|---|---|---|---|
| `@krizaka/auth`, `settings`, `api-keys`, `webhooks`, `organize`, `brief` | krizaka-ts | ADR-006's pattern | Y, A |
| `@krizaka/payments` 0.2.0 | krizaka-ui `packages/payments` | port, Stripe adapter without SDK, `applyOnce`, `pgEventStore`, catalogue setup | Y, A (0.1.0) |
| `@krizaka/email` 0.1.1 | krizaka-ui `packages/email` | React Email templates, `sendEmail`, `DeliveryLog`, `SuppressionList`, `IdempotencyStore` ports (`src/delivery.ts:6-39`) | nobody |
| `@krizaka/push`, `realtime`, `app-config`, `discovery`, `app-client`, `pacer`, `query` | krizaka-ui | push, bus + presence, version contract, mobile discovery, client shell, cadence, server state | O, S, A, K |

## 2. The ranking: duplication × business value

| Rank | Capability | Copies | Value | Why here |
|---|---|---|---|---|
| 1 | `db` | 6 runners, 5 designs | foundation | everything else stands on it |
| 2 | `audit` | 5 tables | legal, admin | the smallest module: it proves the shape |
| 3 | `outbox` | 5 | reliability | mail, webhooks, notifications and coupons need it |
| 4 | `rate-limit` | 6 (3 byte-identical) | abuse | coupons' code validation needs it |
| 5 | `payments` + `credits` + `coupons` | 3 payment stacks, 3 ledgers | revenue, partners | Oussama's priority (#46, #34) |
| 6 | `auth` basics | `password.ts` ×4, `client-ip.ts` ×5, sessions ×6, `/api/me` ×2 contracts | security | small and mechanical |
| 7 | `mail` | 6 | every product | `@krizaka/email` waits to be used |
| 8 | `privacy` (consent, export, erasure) | 6 partial | Loi 25 | each module contributes its own export and erasure |
| 9 | `storage` | 4 | documents, media | #44 is filed |
| 10 | `notifications` | 1 full (O) + 1 partial | engagement | built from O's model on mail + push + realtime |
| 11 | `follows` / `reviews` | 1 + planned | Akinaza's shops, Orochia | #37 is filed (draft PR #38) |
| 12 | admin descriptors | 7 consoles | admin configures everything | needs krizaka-ui screens |
| — | invoices, scheduling, customers, search | 1 product each | — | stay product-local until a second product needs them |

## 3. The module map

| # | Module | Purpose | Ports | Tables (schema) | Events | Settings | Adopters (first in bold) | Depends on |
|---|---|---|---|---|---|---|---|---|
| 1 | `db` | shared types, transactions, module schemas, embedding, test database, upgrade test | `Connection` | `public.krizaka_module_versions` | — | — | **A**, Y, K, O, S, R | — |
| 2 | `audit` | append-only « who did what », filters for the admin, Loi 25 redaction | `AuditStore` | `audit.entry` | — | `audit.retentionDays` | **Y**, A, K, S, O | db |
| 3 | `outbox` | transactional outbox, at-least-once delivery by a leased worker (SKIP LOCKED), retries with backoff, dead letters; consumers idempotent on the event id | `OutboxStore`, `Deliverer` | `outbox.message` | carries everyone's | `outbox.batchSize`, `outbox.maxAttempts`, `outbox.backoffSeconds` | **A**, O, S | db |
| 4 | `rate-limit` | fixed window and token bucket, memory and database stores | `LimitStore` | `rate_limit.bucket` | — | one limit per action (`limits.<action>.perIp`, `.perSubject`, `.windowSeconds`) | **Y**, A, K, O, S, R | db |
| 5 | `payments` | providers (`stripe`, `manual`), checkout, portal, discounts, modes (#34), webhook events applied in the same tx as their effect | `PaymentProvider`, `PaymentStore` | `payments.event`, `payments.customer`, `payments.payment` | `evt.payment.paid.v1`, `evt.subscription.changed.v1`, `evt.checkout.expired.v1` | provider, mode, currencies (#34) | **Y**, A | db, outbox |
| 6 | `credits` | ledger: grant, purchase, debit, hold, release, expire; caps per grant | `LedgerStore` | `credits.entry`, `credits.hold`, `credits.grant` | `evt.credit.granted.v1`, `evt.credit.exhausted.v1` | `credits.holdTtlMinutes` | **Y** (replaces `audit_credits`), O later | db, outbox |
| 7 | `coupons` | discount and credit coupons, partners, redemptions (#46) | `CouponStore`, payments' discount port | `coupons.coupon`, `coupons.redemption`, `coupons.partner` | `evt.coupon.redeemed.v1`, `evt.coupon.exhausted.v1` | `coupons.*` (the design is `docs/design/coupons.md`, added by PR #49; the scope is [#46](https://github.com/krizaka/krizaka-ts/issues/46)) | **Y**, A, Orazaka | db, payments, credits, audit, rate-limit, outbox, settings |
| 8 | `auth` (extended) | + sessions, password hashing, client IP, admin gate, `/api/me` contract (krizaka-ui#551), IdentityProvider (#32) | `SessionStore`, `IdentityProvider` | `auth.session` (adopts `sessions`) | `evt.account.created.v1` | `auth.sessionDays`, `auth.allowedAdminIps` | **A**, Y, K | db |
| 9 | `mail` | `@krizaka/email` + its stores (delivery log, suppression, idempotency) + providers (Mailgun, Resend, log) + outbox delivery | `MailProvider` | `mail.delivery`, `mail.suppression` | `evt.mail.bounced.v1` | `mail.from`, `mail.replyTo` (secrets stay in env) | **A** (its outbox is never flushed today), Y, O, S, R, K | db, outbox |
| 10 | `privacy` | consents by purpose and version, export assembled from every module's `exportFor`, erasure through every module's `eraseFor`, retention | `PrivacyContributor` (implemented by each module) | `privacy.consent`, `privacy.request` | `evt.privacy.erased.v1` | `privacy.exportSyncBudgetMs`, retention per purpose | **Y**, A, S, O, R | db, audit, outbox |
| 11 | `storage` (#44) | object store (put, get, delete, signed URL), Bunny, S3, local, memory, encrypted wrapper | `ObjectStore` (the shape of `organize`'s and Y's port) | `storage.object` (metadata, quota) | — | `storage.maxBytes`, quotas | **Y**, A, O, S | db |
| 11b | `video` (#44) | video creation, signed TUS uploads, playback tokens, status webhooks; Bunny Stream first | `VideoProvider`, `VideoStore` | `video.asset` (provider id, status, owner) | `evt.video.ready.v1`, `evt.video.failed.v1` | token lifetime, upload size limits | **O** (Bunny Stream today, `packages/media/src/bunny-client.ts:22`), S | db, outbox, webhooks |
| 12 | `notifications` | in-app bell, channels (e-mail via `mail`, push via `@krizaka/push`, live via `@krizaka/realtime`), preferences matrix, burst caps | `ChannelDelivery` | `notifications.item`, `notifications.preference`, `notifications.device` | `evt.notification.requested.v1` (same name as Java's) | categories × channels defaults, caps | **O** (from its model), S, A | db, outbox, mail |
| 13 | `follows`, `reviews` (#37) | subscribe to a target, ratings with a Bayesian score | `FollowStore`, `ReviewStore` | `follows.follow`, `reviews.review` | `evt.follow.created.v1`, `evt.review.published.v1` | prior and weight of the score | **A**, O | db, outbox |
| 14 | admin descriptors | each module's `./admin` read by generic @krizaka/ui screens | — | — | — | — | **Y** | each module |
| — | `settings`, `api-keys`, `webhooks`, `organize`, `brief` (existing) | unchanged purpose; adopt `db`'s types, declare their schema, move to their own schema in their next major (`settings` first) | as today | adopted in `public`, then their own schema | — | as today | Y, A | db |

**Not modules:** feature flags are settings (`flag()`, `packages/settings/src/registry.ts:34`). `@krizaka/orazaka-client` (#33) is a provider adapter (an AI port that products and modules call), not a business module.

### 3.1 The same map as an ordered list

1. **db.** Shared types, transactions, module schemas embedded in the product's sequence, the test database. One table, `krizaka_module_versions`. First adopter: Akinaza. Depends on nothing.
2. **audit.** Who did what, append-only, in `audit.entry`, with a retention setting. First adopter: Yomizaka. Depends on db.
3. **outbox.** Events written in the transaction, delivered at least once by a leased worker (duplicates possible after a crash, so consumers are idempotent), in `outbox.message`. First adopter: Akinaza. Depends on db.
4. **rate-limit.** Limits per action from settings, memory or database store, in `rate_limit.bucket`. First adopter: Yomizaka. Depends on db.
5. **payments.**
   - Providers stripe and manual, checkout, portal and discounts.
   - Events are applied in the same transaction as their effect.
   - Tables `payments.event`, `customer`, `payment`.
   - First adopter: Yomizaka. Depends on db and outbox.
6. **credits.**
   - A ledger with caps per grant, in `credits.entry`, `hold` and `grant`.
   - It follows krizaka-billing's model.
   - First adopter: Yomizaka. Depends on db and outbox.
7. **coupons.**
   - Discount and credit coupons, partners and redemptions, in `coupons.coupon`, `redemption` and `partner`.
   - First adopter: Yomizaka.
   - Depends on db, payments, credits, audit, rate-limit, outbox and settings.
8. **auth basics.**
   - Sessions, password, client IP, the admin gate and the `/api/me` contract, in `auth.session`.
   - First adopter: Akinaza. Depends on db.
9. **mail.**
   - Templates from `@krizaka/email`, providers, delivery log and suppression, delivered through the outbox.
   - Tables `mail.delivery`, `suppression`.
   - First adopter: Akinaza. Depends on db and outbox.
10. **privacy.**
    - Consents, export and erasure assembled from every module.
    - Tables `privacy.consent`, `request`.
    - First adopter: Yomizaka. Depends on db, audit and outbox.
11. **storage.** Objects behind one port, Bunny, S3, local, memory, encrypted, in `storage.object`. First adopter: Yomizaka. Depends on db.

    **video.** Videos behind one port:
    - creation, signed TUS uploads, playback tokens and status webhooks;
    - Bunny Stream first;
    - table `video.asset`.

    First adopter: Orochia. Depends on db, outbox and webhooks.
12. **notifications.**
    - Bell, channels, preferences and caps.
    - Tables `notifications.item`, `preference`, `device`.
    - First adopter: Orochia. Depends on db, outbox and mail.
13. **follows and reviews.** In `follows.follow` and `reviews.review`. First adopter: Akinaza. Depends on db and outbox.
14. **admin descriptors.** Each module's admin resource, read by generic screens in @krizaka/ui. First adopter: Yomizaka. Depends on each module.

## 4. Java alignment

| TypeScript module | Java building block | Same name? | Same boundary? | What to align |
|---|---|---|---|---|
| `db` | `krizaka-persistence` (`KrizakaMigrations`, `KitSchema`) | functionally | yes | Versioned, frozen schema sets, and adoption of existing tables (`baselineOnMigrate`). The ordering differs on purpose (ADR-001 §6). |
| `outbox` | `krizaka-messaging` (`krizaka_outbox`, `processed_messages`) | name differs | yes | The envelope fields (id, type, occurredAt, payload) and the consumer dedup claim. |
| `auth` | `krizaka-users` (`-api`, `-client`, `-core`, `-persistence`, `-service`) | **no** (`auth` / `users`) | TS = accounts in the product's DB; Java = a service. Federation joins them (#32). | Keep both names: renaming a published package costs more than the mismatch. The site and the map say « auth ↔ users ». |
| `payments` + `credits` | `krizaka-billing` (`-api`, `-client`, `-service`) | partly | Java has no provider (`PackSubscriptionService.java:30-33`); TS has Stripe | The ledger model: buckets `GRANTED`/`PURCHASED`, entry types `GRANT\|PURCHASE\|DEBIT\|REFUND\|EXPIRY\|ADJUSTMENT`, holds with a TTL, `idempotency_key` per entry (`70-billing.sql:145-184`). The event names (`evt.credit.granted.v1`). |
| `notifications` | `krizaka-notifications` (`-api`) | yes | Java delivers (SMTP, SMS, webhook); TS also keeps the bell and preferences | The event `evt.notification.requested.v1` (its JSON Schema is in `krizaka-notifications-api`). |
| `settings` / `app-config` | `krizaka-app-config` (platform kit); `@krizaka/app-config` (krizaka-ui) is already its TS twin | yes (`app-config`) | app-config = version compatibility; settings = admin parameters | Keep them two modules. Java's `billing_runtime_config` is a `settings` equivalent. |
| `webhooks` | `krizaka-webhooks` | yes | yes | Standard Webhooks signing (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,…`). |
| `rate-limit` | `krizaka-ratelimit` | spelling differs | yes | Observe and enforce modes, 429 with `Retry-After`. |
| `coupons`, `audit`, `mail`, `privacy`, `storage`, `follows`/`reviews` | none | — | — | When Java needs one, it takes the TypeScript name and the contract (events, refusal codes). |

## 5. The cut: one issue, one pull request

Each line below is ready to file. The CTO files them after « validé »; the product adoptions are separate issues in each product.

| # | Issue (krizaka-ts) | Scope | Acceptance | First adopter (separate PR) |
|---|---|---|---|---|
| 1 | `feat(db): @krizaka/db: shared types, transactions, module schemas, test database` | `Query`/`Database`/`Clock`/`ModuleSchema`; `transaction`; `emitMigration` + marker table; `assertModules`; `assertEmbedded`; a runner for products without one; `@krizaka/db/testing` (`createTestDatabase({ connect, migrate })` with an injected connection factory and migration sequence, `assertUpgrade`) | Unit tests; integration on CI's PostgreSQL: fresh DB, two modules with a cross-FK, upgrade N-1 → N, adopt existing tables; no network beyond the DB; README, changeset | Akinaza: its 6 generators become `emitMigration`, behaviour unchanged |
| 2 | `refactor: the six packages on @krizaka/db (types, schema declaration, adopt markers)` | Each package declares its `ModuleSchema` (tables in `public`, adopted); `Query`/`Clock` from `db`; folds in #30's functional names | Every package's tests green; Akinaza's and Yomizaka's databases adopt with no DDL change | Yomizaka |
| 3 | `feat(audit): @krizaka/audit` | `audit.entry`, `record(tx, …)`, filters, retention, Loi 25 redaction | contract kit on memory and PG | Yomizaka (`lib/audit.ts`) |
| 4 | `feat(outbox): @krizaka/outbox` | `append(tx, event)`, leased worker, backoff, dead letters, settings | an exclusive claim: two workers never hold the same row during a valid lease; a crash test where a worker delivers then dies before acknowledging, and the row is delivered again after the lease (at least once); an idempotent consumer test where a repeated event id has one effect; retry then dead letter | Akinaza (`mail_outbox`, webhook deliveries) |
| 5 | `feat(rate-limit): @krizaka/rate-limit` | memory + DB stores, limits from settings | the three byte-identical copies' tests pass on the package | Yomizaka, then A, K |
| 6 | `feat(payments): @krizaka/payments moves to krizaka-ts; events applied in the effect's transaction; discounts` | the package and its history move (same name, next minor); `applyInTransaction(tx, event, handlers)`; `discount` in `CheckoutRequest`; `checkout_expired` event; #34's modes after | a failing handler leaves the event unrecorded (the test that is missing today); Stripe mocked | Yomizaka |
| 7 | `feat(credits): @krizaka/credits` | ledger, holds, caps per grant, krizaka-billing's entry types | concurrent debit of the last credit; cap per day and month | Yomizaka (`audit_credits` → ledger, behaviour unchanged) |
| 8 | `feat(coupons): @krizaka/coupons` (#46) | the design `docs/design/coupons.md` (PR #49), once #46's phase 1 is validated; the scope is [#46](https://github.com/krizaka/krizaka-ts/issues/46) | see #46 phase 2 | Yomizaka, then Akinaza, then Orazaka |
| 9 | `feat(auth): sessions, password, client IP, admin gate, /api/me contract` | the byte-identical files become exports; contract of krizaka-ui#551 | the copied tests pass on the package | Akinaza, Yomizaka, Kachizaka |
| 10 | `feat(mail): @krizaka/mail on @krizaka/email` | stores for delivery log, suppression, idempotency; Mailgun/Resend/log providers; outbox delivery | an outbox flush that really runs (Akinaza's gap) | Akinaza |
| 11 | `feat(privacy): @krizaka/privacy` | consents, `PrivacyContributor`, export, erasure, retention | each existing module contributes; an export lists every module's data | Yomizaka |
| 12 | `feat(storage, video)` (#44) | as #44 says, on `db`'s types: two packages, `storage` and `video` | as #44 | Yomizaka (storage), Orochia (video) |
| 13 | `feat(notifications): @krizaka/notifications` | Orochia's matrix and burst caps, channels | preferences respected per channel; caps | Orochia |
| 14 | `feat(community)` (#37) | as #37, on `db` and `outbox` | as #37 | Akinaza |
| 15 | krizaka-ui: `feat(admin): generic module screens from ./admin descriptors` | table, filters, detail, actions | coupons' screens built from them | Yomizaka |

### 5.1 Delivery status (2026-10-26)

| Cut | State |
|---|---|
| 1 `db` | published (`@krizaka/db`) |
| 2 the six packages on `db` | block B46 (#51) |
| 3 `audit` | published (`@krizaka/audit`) |
| 5 `rate-limit`, 4 `outbox`, 9 `auth` basics, 11 `privacy` | block B47 (#54, #53, #57, #59) |
| 6 `payments`, 7 `credits`, 8 `coupons` | block B48 |
| 10 `mail`, 12 `storage`, 13 `notifications` | block B49 |

## 6. Where the coordinated issues fit

| Issue | Where it fits |
|---|---|
| #44 storage, video | modules 11 (`storage`) and 11b (`video`), two packages as #44 says. Built on `db`'s types; storage's port keeps the shape `organize` and Yomizaka already use. |
| #46 coupons | module 7, after `payments` (discounts, transactional events) and `credits`. |
| #34 payments | module 5. The package moves here first; the modes (online, on site, after) follow in the same module. |
| #37 / #38 follows, reviews | module 13. The draft PR #38 should take `db`'s `Query`/`Clock` and declare its schema before it merges. |
| #33 orazaka-client (#39 is its closed Copilot PR) | not a business module: a provider adapter that modules and products call. Unchanged. |
| #30 functional names | folded into cut #2. |
| #32 IdentityProvider | part of module 8. |
| krizaka-ui#551 `/api/me` | the first `./contract` (module 8). |
