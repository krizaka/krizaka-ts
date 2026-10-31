# Coupons: the design

This is the design of [ADR-002](../adr/ADR-002-coupons.md) for krizaka/krizaka-ts#46. It sits in ADR-001's module map as module 7: after `payments` (5) and `credits` (6), and on `db`, `audit`, `rate-limit`, `outbox` and `settings`.

**Sources:** a read-only pass over `main` on 2026-10-23: yomizaka `7b77d2e`, akinaza `86d35a2`, a former product `239e402`, orazaka-web-client, and krizaka-billing.

## 1. What exists today

### 1.1 How each product charges

| Product | Provider | Prices | Checkout and portal | Webhook and idempotency | Entitlements | Taxes |
|---|---|---|---|---|---|---|
| **Yomizaka** | `@krizaka/payments` 0.1.0, Stripe adapter without the SDK (`apps/web/package.json:22`) | Two plans hard-wired: `audit` (payment) and `pro` (subscription) (`apps/web/lib/payments/config.ts:19-22`). Amounts are Stripe's, found by `PAYMENTS_PRICE_KEY_{AUDIT,PRO}`. The 9,99 / 29 $ appear only in `messages/en.json:823`. | `app/api/billing/checkout/route.ts:17-34`: session, rate limit 30/h IP and 10/h account, the `payments.enabled` setting, customer created once (`customer-<accountId>`), audit `billing.checkout_started`. `app/api/billing/portal/route.ts:11-21`. | `app/api/webhooks/payments/route.ts:12-25`: `parseWebhook` (HMAC, 300 s) then `applyOnce` + `pgEventStore` on `payment_events` (`lib/migrations.ts:253-257`). | On `accounts` (migration 0009): `plan`, `subscription_status`, `payment_subscription_id`, `current_period_end`, `audit_credits`, `free_audit_used_at`. `reserveAudit` / `releaseAudit` / `refundFailedAudit` (`lib/billing.ts:46-74`); caps from settings (`lib/settings/boundary.ts:55-65`). | Stripe Tax: `automatic_tax`, `tax_id_collection`, required address (`krizaka-ui packages/payments/src/stripe.ts:137-151`) |
| **Akinaza** | `@krizaka/payments` 0.1.0 | One plan, `founder`, lookup key `PAYMENTS_PRICE_KEY_FOUNDER` (`apps/web/lib/payments/config.ts:12-21`). The 39 $ is a **price** set up from `payments/catalogue.json` (3900 cents CAD, `txcd_10103001`) by `krizaka-payments-setup`, shown only when `APP_FOUNDER_OFFER_ENABLED` (`lib/founder-offer.ts:11-17`). | `app/api/billing/checkout/route.ts:14-37`: rate limit 20/h, `customerOf` (`lib/billing.ts:30-36`); `app/api/billing/portal/route.ts:14-30` | Same pattern, `payment_events` (migration 0010) | Subscription state only, same four columns (0010), `subscriptionOf` (`lib/billing.ts:11-27`) | Stripe Tax (same adapter) |
| **a former product** | own a retired export: CCBill, Segpay, NowPayments, Stripe, credits (`packages/payments/src/types.ts:3,49-56`) | 4 credit packs with bonus credits (`packages/payments/src/credits.ts:20-25`), USD | Top-up: `app/api/me/wallet/topups/route.ts:19-46`, 10/h | `app/api/webhooks/payments/[gateway]/route.ts:23-66`. No event table: idempotency comes from row locks, statuses and unique references (`intents.ts:52-75`, `schema/ledger.ts:50-53`). | Append-only `wallet_ledger` in cents; the balance is a SUM; types TOPUP, SPEND, REFUND, ADJUSTMENT, HOLD, RELEASE (`schema/wallet.ts:32-51`, `schema/enums.ts:105`); advisory lock per wallet (`credits.ts:95`); escrow holds for auctions and challenges | none (USD) |
| **Orazaka** | none: « No payment is captured here » (`krizaka-billing-service/.../PackSubscriptionService.java:30-33`) | Plans, packs and pricebook in `krizaka_billing_db` (`infra/initdb/70-billing.sql:28-114`), seeded in CAD (`:356-358`) | Console only (`orazaka-web-client src/console/features/billing/`, `billing.admin.api.ts:61-201`) | `processed_messages`, `billing_outbox` (`70-billing.sql:298,318`) | `credit_wallet` with `GRANTED` and `PURCHASED` buckets, `credit_ledger_entry` (GRANT, PURCHASE, DEBIT, REFUND, EXPIRY, ADJUSTMENT; append-only by trigger), `credit_hold` (`70-billing.sql:133-184`) | none |

### 1.2 What exists of coupons

- **No coupon, promo code, voucher or discount exists in any product.** I searched for `coupon`, `promo`, `discount`, `voucher` and `allow_promotion_codes` in the four repositories and krizaka-billing.
- **The closest things:**
  - Yomizaka's first free audit (`free_audit_used_at`, setting `audit.freeFirst`);
  - Yomizaka's per-user `limits.bonusAuditsPerMonth`, which only raises the Pro cap (`lib/settings/boundary.ts:62`);
  - a former product's pack bonuses;
  - Orazaka's signed admin adjustment, capped per admin per day (`CreditAdjustmentService.java:34,87,153`; `billing.adjustment.daily-max-credits`, `70-billing.sql:347`).
- **« Discount » appears only on Akinaza's invoice lines** (`packages/core/src/tax.ts:69-74`), which have nothing to do with billing.

### 1.3 What is duplicated between Yomizaka and Akinaza

| Piece | Yomizaka | Akinaza | Moves to |
|---|---|---|---|
| Vendor choice from env | `lib/payments/config.ts` | `lib/payments/config.ts` (same pattern) | stays in the product (it reads env); the package exposes `choosePaymentsProvider(config)` |
| Checkout, portal, webhook routes | 3 routes | 3 routes | `@krizaka/payments` route handlers |
| `payment_events` migration | 0009 | 0010 (hand-written) | `payments.event` (adopted) |
| Subscription state on `accounts` | 4 columns + `subscription_*` handlers (`lib/billing.ts:80-101`) | 4 columns + handlers (`lib/billing.ts:39-54`) | `payments.subscription` (adopted, columns backfilled) |
| Customer creation once | inline in the route | `customerOf` | `@krizaka/payments` |
| Credits | `audit_credits`, free audit, `reserveAudit` | — | `@krizaka/credits` |

### 1.4 What `@krizaka/payments` lacks for coupons

| Gap | Today | Needed |
|---|---|---|
| Discount input on checkout | `CheckoutRequest` has none (`packages/payments/src/port.ts:15-22`) | `discount?: DiscountTerms` |
| Expired sessions | `translate` ignores `checkout.session.expired` (`stripe.ts:78-108`) | translated, to release reservations |
| Refunds | not translated | translated, to mark redemptions refunded |
| Amounts and the checkout reference on events | `payment_paid` carries `kind`, `accountId`, `customerId` only (`port.ts:10`) | `amountTotal`, `amountDiscount`, `currency`, `checkoutRef` |
| Idempotency in the effect's transaction | `applyOnce` records the id before the handler, outside its transaction (`events.ts:15-21`) | the record and the handler in one `tx` |

All five gaps are in ADR-001's cut #6.

## 2. The model

Everything lives in the Postgres schema `coupons` of the product's database. `owner` is the product's account table, passed as a parameter (ADR-001 §3).

```sql
CREATE SCHEMA IF NOT EXISTS coupons;

CREATE TABLE coupons.partner (
  id            uuid PRIMARY KEY,
  display_name  text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
  contact_email text CHECK (contact_email IS NULL OR contact_email = lower(contact_email)),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL,
  created_by    uuid REFERENCES <owner>(id) ON DELETE SET NULL,
  erased_at     timestamptz,             -- Loi 25: name and e-mail set to NULL, aggregates kept
  CHECK (erased_at IS NOT NULL OR display_name IS NOT NULL),                        -- a live partner has a name
  CHECK (erased_at IS NULL OR (display_name IS NULL AND contact_email IS NULL))     -- an erased one has nothing identifying
);

CREATE TABLE coupons.coupon (
  id                uuid PRIMARY KEY,
  code              text NOT NULL CHECK (char_length(code) BETWEEN 4 AND 40),          -- as the admin typed it
  code_key          text NOT NULL UNIQUE CHECK (code_key = upper(code_key)),           -- normalised: case-insensitive, unique in the product
  kind              text NOT NULL CHECK (kind IN ('discount', 'credit')),
  purpose           text NOT NULL CHECK (purpose IN ('partner', 'promo', 'demo', 'support')),
  partner_id        uuid REFERENCES coupons.partner(id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz,
  max_redemptions   integer CHECK (max_redemptions > 0),                               -- null = no overall limit
  max_per_account   integer NOT NULL DEFAULT 1 CHECK (max_per_account > 0),
  new_customers_only boolean NOT NULL DEFAULT false,
  plans             text[] NOT NULL DEFAULT '{}',                                      -- plan kinds of the product; empty = all
  -- discount terms (immutable after the first redemption)
  percent_off_bp    integer CHECK (percent_off_bp BETWEEN 1 AND 9999),                 -- basis points; 100 % is never a discount
  amount_off_minor  integer CHECK (amount_off_minor > 0),                             -- never the whole price: §2, « No free discount »
  currency          text CHECK (currency ~ '^[a-z]{3}$'),
  duration          text CHECK (duration IN ('once', 'repeating', 'forever')),
  duration_months   integer CHECK (duration_months BETWEEN 1 AND 36),
  minimum_minor     integer CHECK (minimum_minor >= 0),
  -- credit terms (immutable after the first redemption)
  credits           integer CHECK (credits > 0),
  cap_per_day       integer CHECK (cap_per_day > 0),
  cap_per_month     integer CHECK (cap_per_month > 0),
  credits_valid_days integer CHECK (credits_valid_days > 0),
  on_exhausted      text CHECK (on_exhausted IN ('stop', 'fallback_paid')),
  terms_version     integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL,
  created_by        uuid REFERENCES <owner>(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((purpose = 'partner') = (partner_id IS NOT NULL)),
  CHECK (kind <> 'discount' OR (credits IS NULL AND num_nonnulls(percent_off_bp, amount_off_minor) = 1
         AND (amount_off_minor IS NULL OR currency IS NOT NULL) AND duration IS NOT NULL
         AND ((duration = 'repeating') = (duration_months IS NOT NULL))
         AND (amount_off_minor IS NULL OR duration <> 'forever'))),                    -- a fixed amount never runs forever
  CHECK (kind <> 'credit' OR (credits IS NOT NULL AND on_exhausted IS NOT NULL
         AND credits_valid_days IS NOT NULL                                            -- every grant expires
         AND num_nulls(percent_off_bp, amount_off_minor, duration) = 3))
);

CREATE TABLE coupons.redemption (
  id               uuid PRIMARY KEY,
  coupon_id        uuid NOT NULL REFERENCES coupons.coupon(id) ON DELETE RESTRICT,
  account_id       uuid REFERENCES <owner>(id) ON DELETE SET NULL,                   -- a deleted account leaves the row: uses and revenue stay
  partner_id       uuid REFERENCES coupons.partner(id) ON DELETE SET NULL,           -- copied at redemption: attribution never moves
  status           text NOT NULL CHECK (status IN ('reserved', 'confirmed', 'released', 'revoked')),
  idempotency_key  text NOT NULL UNIQUE,                                              -- apply() twice = the same row
  reserved_until   timestamptz,                                                       -- discount: the reservation's end
  checkout_ref     text UNIQUE,                                                       -- the provider's session
  payment_ref      text UNIQUE,                                                       -- the provider's payment: confirmed once
  amount_paid_minor     integer,
  amount_discount_minor integer,
  amount_refunded_minor integer NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),  -- cumulative, partial or full
  use_restored     boolean NOT NULL DEFAULT false,                                    -- a full refund gave the use back (setting)
  currency         text,
  credit_grant_id  uuid,                                                              -- @krizaka/credits' grant
  over_limit       boolean NOT NULL DEFAULT false,                                    -- a late payment honoured past a limit
  created_at       timestamptz NOT NULL,
  confirmed_at     timestamptz,
  ended_at         timestamptz
);
CREATE INDEX redemption_uses ON coupons.redemption (coupon_id, account_id) WHERE status <> 'released' AND NOT use_restored;
```

- **Status:**
  - `active`, `paused` and `archived` are stored.
  - **Expired** and **exhausted** are computed (`now ≥ ends_at`; live redemptions ≥ `max_redemptions`). They need no cron, and the admin list shows them as such.
  - « Not started » (`now < starts_at`) is computed too.
- **The counting rule:** a redemption **consumes a use** when it is `confirmed` or `revoked` and not `use_restored`, or when it is `reserved` and `reserved_until > now`. A `released` redemption never counts. A refund does not change the status (§4.3), so a refunded use still counts unless the setting restored it. The overall and per-account limits both apply this one rule.
- **A deleted account** sets `account_id` to NULL. The redemption keeps counting toward the overall limit and stays in the partner's revenue.
- **No free discount.**
  - `percent_off_bp` stops at 99.99 % and `coupons.maxPercentOff` bounds it further.
  - A fixed amount is never `forever`.
  - At `apply`, the discount must leave something to pay: `amount_off_minor ≤ price × coupons.maxPercentOff`, else `COUPON_TOO_LARGE`.
  - When a plan's price changes, the product calls `coupons.admin.checkPrices(prices)`. It pauses every live amount coupon that would now exceed that bound, and audits it.
  - Free usage is always a capped credit coupon.
- **Audit:** every create, update, pause, resume, archive, revoke and partner change writes `@krizaka/audit` (who, when, before and after), in the same transaction.

## 3. Partners: the minimum

- **The record:** display name, optional contact e-mail, status. The admin creates partners and gives them coupons (`purpose = 'partner'`).
- **The partner view** (admin only), per period, from the redemptions that consume a use (§2's rule):
  - the count of redemptions;
  - the discount given;
  - the revenue (`amount_paid_minor − amount_refunded_minor`; a 100 $ purchase with a 10 $ refund counts 90 $);
  - the credits granted;
  - per coupon. Never the customers' identities.
- **Commission:** out of scope. The hook is `evt.coupon.redeemed.v1`, which carries `partnerId`, `amountPaidMinor`, `amountDiscountMinor`, `currency` and `credits`. A later `commissions` module consumes it from the outbox; nothing here computes money owed.
- **Loi 25:**
  - **Collect:** only a name and an e-mail, for one purpose: attributing sales.
  - **Access:** only the admin role, and every read of the partner view is audited.
  - **Export:** `privacy.exportFor(partner)` returns the record and its aggregates.
  - **Erase:** blanks the name and e-mail (`erased_at`) and keeps the aggregates. The redemptions are accounting records.
  - **TO VALIDATE (Oussama, with the accountant):** how long redemption records with amounts must be kept.

## 4. The flows

### 4.1 A discount at checkout (Stripe)

1. The person types a code in « Code promo ».
2. The product calls `coupons.validate(code, context)`.
   - It is rate-limited per account and per IP, before any lookup (settings).
   - The context is the account, the plan, the amount, the currency, whether the account has paid before (from `payments`), and `now`.
   - It answers the effect (« −20 % for 3 months ») or a typed refusal.
3. On « Pay », in **three steps**. No network call ever happens inside a transaction or under the coupon's row lock.
   1. **Reserve (a short transaction).** `coupons.apply(tx, { code, accountId, plan, amount, currency, idempotencyKey })` locks the coupon row, re-checks everything, inserts a `reserved` redemption with `reserved_until = now + coupons.reservationMinutes`, and commits. The lock is held only for that insert. It returns the redemption id and the `DiscountTerms`.
   2. **Create the session (outside any transaction).** `payments.checkout({ …, discount: terms, idempotencyKey: redemptionId, metadata: { redemption_id }, expiresAt })`:
      - the Stripe adapter finds or creates the Stripe coupon for `(coupon.id, terms_version)` and sends `discounts: [{ coupon }]`;
      - the Stripe idempotency key is the redemption id, so a retry returns the same session;
      - if the call fails, the product calls `coupons.release(tx, redemptionId)` at once.
   3. **Attach (a second short transaction).** `coupons.attachCheckout(tx, redemptionId, checkoutRef, sessionExpiresAt)` stores the session and sets `reserved_until = max(reserved_until, sessionExpiresAt + 5 min)`, so the reservation outlives the session.
   - **If step 3 never happens** (a crash, a failed commit), nothing is lost:
     - the webhook finds the redemption by `metadata.redemption_id`, not only by `checkoutRef`;
     - an unpaid session expires on its own and its `checkout_expired` releases the use;
     - the sweeper releases reservations past `reserved_until`.
   - **A webhook that arrives before step 3** is handled the same way, through `metadata.redemption_id`.
   - **The deadline protocol.** Stripe accepts a session `expires_at` from 30 minutes to 24 hours after creation. So:
     - `coupons.reservationMinutes` is bounded 40–1440;
     - the adapter asks for `expiresAt = reservedAt + reservationMinutes − 5 min`;
     - if that is less than 31 minutes from the moment of the call (the reservation is too old), it refuses, and the product releases and re-applies.
4. The webhook `payment_paid` / `subscription_started` arrives with `checkoutRef`, `paymentRef`, `metadata.redemption_id` and the amounts. In **one transaction**, `payments` records the event id and calls `coupons.redeem(tx, { redemptionId, checkoutRef, paymentRef, amountPaid, amountDiscount, currency })`.
   - The guarded transition is `UPDATE … SET status = 'confirmed' WHERE id = $1 AND status IN ('reserved', 'released')`. A `released` row confirmed this way gets `over_limit = true`.
   - A replay finds the event already recorded and does nothing.
   - A second event for the same payment hits `payment_ref UNIQUE` and does nothing.
5. On `checkout_expired`, or the sweeper (`reserved_until < now`), `reserved` becomes `released` and the use is free again.
6. **A payment that arrives after the release, or past a limit, is confirmed anyway, with `over_limit = true`** (the `released → confirmed` transition of step 4). The customer was charged the discounted price, so we honour it, audit it, and show it in the admin.

### 4.2 A credit coupon

1. `coupons.redeemCredit(tx, { code, accountId, idempotencyKey })` checks the same rules under the row lock and inserts a `confirmed` redemption.
2. In the same transaction it calls `credits.grant(tx, { accountId, credits, capPerDay, capPerMonth, expiresAt: now + credits_valid_days, onExhausted, source: 'coupon:<redemptionId>' })`.
3. The product spends through `credits.consume(tx, { accountId, amount, reason })`. The ledger:
   - draws from the grants that expire first;
   - refuses beyond a grant's cap of the day or month (`CREDITS_CAP_DAY`, `CREDITS_CAP_MONTH`);
   - when a `stop` grant is empty, answers `CREDITS_EXHAUSTED`;
   - when a `fallback_paid` grant is empty, moves on to purchased credits, then answers `PAYWALL` so the product shows its paid plan.
4. The days and months are counted in the product's time zone (setting `credits.timeZone`). The clock is injected.

### 4.3 Refunds and revocation

- **A refund** (`payment_refunded`, full or partial) adds to `amount_refunded_minor`, is audited, and **does not change the status**.
  - The use keeps counting. Only a **full** refund with `coupons.refundRestoresUse` on (default **off**) sets `use_restored = true` and gives the use back.
  - A partial refund never restores a use, so a refund cannot reset a single-use code.
  - The tax is Stripe's to adjust on its refund.
- **Revoking a credit redemption** (admin): it becomes `revoked`, and `credits.expire(tx, grantId)` writes an EXPIRY for what remains. Credits already spent are never clawed back.

## 5. The package

### 5.1 API (`@krizaka/coupons`)

```ts
createCoupons(deps: { store: CouponStore; clock: Clock; settings: CouponSettings; audit: AuditPort; outbox: OutboxPort;
                      credits: CreditsPort; rateLimit: RateLimitPort }): Coupons

interface Coupons {
  validate(code: string, context: CheckoutContext): Promise<Validation>;                 // read-only, never reserves
  apply(tx: Query, input: ApplyInput): Promise<{ redemptionId: string; discount: DiscountTerms }>;   // idempotent by key
  attachCheckout(tx: Query, redemptionId: string, checkoutRef: string): Promise<void>;
  redeem(tx: Query, input: RedeemInput): Promise<"confirmed" | "already" | "unknown">;  // payment webhook, in its tx
  release(tx: Query, checkoutRef: string): Promise<void>;                                // expired checkout
  releaseExpired(tx: Query): Promise<number>;                                            // the sweeper (outbox worker)
  refund(tx: Query, input: { paymentRef: string; amountRefunded: number }): Promise<void>;
  redeemCredit(tx: Query, input: { code: string; accountId: string; idempotencyKey: string }): Promise<CreditRedemption>;
  revoke(tx: Query, actor: Actor, redemptionId: string): Promise<void>;
  admin: CouponAdmin;   // create, update (window, limits, status, partner), pause, resume, archive, list, get,
                        // redemptions, partners CRUD, partnerReport, generateCode
}

type Validation = { ok: true; coupon: CouponView; effect: DiscountEffect | CreditEffect } | { ok: false; code: CouponRefusal };

/** What a provider adapter needs to apply a discount: vendor-free, immutable per (couponId, termsVersion). */
interface DiscountTerms { couponId: string; termsVersion: number; percentOffBp?: number; amountOffMinor?: number;
                          currency?: string; duration: "once" | "repeating" | "forever"; durationMonths?: number }
```

`grantCredits` and `consumeCredits` (#46 §5) are `@krizaka/credits`' `grant` and `consume`. The coupons module calls `grant`, and the product calls `consume`.

### 5.2 Refusal codes (typed, `as const`)

| Code | When |
|---|---|
| `COUPON_UNKNOWN` | no coupon with this code |
| `COUPON_NOT_STARTED` | `now < starts_at` |
| `COUPON_EXPIRED` | `now ≥ ends_at` |
| `COUPON_PAUSED` | paused or archived |
| `COUPON_EXHAUSTED` | live redemptions ≥ `max_redemptions` |
| `COUPON_ACCOUNT_LIMIT` | the account's live redemptions ≥ `max_per_account` |
| `COUPON_NEW_CUSTOMERS_ONLY` | the account has paid before |
| `COUPON_NOT_FOR_PLAN` | the plan is not in `plans` |
| `COUPON_MINIMUM` | the amount is under `minimum_minor` |
| `COUPON_CURRENCY` | the amount coupon's currency is not the checkout's |
| `COUPON_TOO_LARGE` | the discount would leave less than the allowed share of the price to pay (§2, « No free discount ») |
| `COUPON_KIND` | a credit code at checkout, or a discount code where credits are redeemed |
| `COUPON_PROVIDER` | the product's provider cannot apply discounts (CCBill, Segpay) |
| `COUPON_RATE_LIMITED` | too many attempts (with `Retry-After`) |

### 5.3 Events (outbox, JSON Schema each)

| Event | When |
|---|---|
| `evt.coupon.redeemed.v1` | confirmed, both kinds; carries partner and amounts |
| `evt.coupon.released.v1` | a reservation released |
| `evt.coupon.refunded.v1` | a refund |
| `evt.coupon.exhausted.v1` | the last allowed use confirmed |
| `evt.credit.granted.v1`, `evt.credit.exhausted.v1` | from `@krizaka/credits`, with the same names as `krizaka-billing-api` |

### 5.4 Settings (`coupons.*`, global scope, registered by the product, every change audited)

| Key | Kind | Default | Bounds | What it does |
|---|---|---|---|---|
| `coupons.enabled` | flag | false | — | shows the field and accepts codes |
| `coupons.reservationMinutes` | integer | 60 | 40–1440 min | how long a checkout holds a use; bounded by Stripe's session window, 30 min to 24 h (§4.1) |
| `coupons.attemptsPerAccountPerHour` | integer | 10 | 1–100 | validation rate limit |
| `coupons.attemptsPerIpPerHour` | integer | 30 | 1–500 | validation rate limit |
| `coupons.minCodeLength` | integer | 8 | 4–40 | shortest code the admin may type |
| `coupons.generatedCodeLength` | integer | 10 | 8–20 | generated codes (Crockford base32, no I, L, O, U) |
| `coupons.maxPercentOff` | integer | 50 | 1–99 % | the highest percent a discount may have (**TO VALIDATE**: the default is Oussama's call) |
| `coupons.refundRestoresUse` | flag | false | — | a refund gives the use back |
| `credits.timeZone` | choice | `America/Toronto` | IANA list | the day and month of the caps |

**Environment:** nothing new. The provider keys stay `PAYMENTS_PROVIDER`, `PAYMENTS_STRIPE_SECRET_KEY` and `PAYMENTS_STRIPE_WEBHOOK_SECRET`, as today (Yomizaka `lib/env.ts`). A coupon never needs a secret.

## 6. The admin and UI side

### 6.1 Admin screens (each product's console)

| Screen | Content | @krizaka/ui pieces |
|---|---|---|
| Coupons | Table: code, kind, purpose, partner, status (active, paused, expired, exhausted, not started), window, uses / limit. Filters: status, kind, purpose, partner, with URL state (`?q=&status=&kind=&partner=&page=`). Actions: create, pause or resume, archive. | `data-table`, `filter-bar`, `search-field`, `badge`, `chip`, `empty-state` |
| Create / edit | Kind (discount or credit) → its own fields. Code typed or generated. Purpose; partner (required for `partner`); window; limits; new customers only; plans. Discount: percent or amount + currency, duration, months, minimum. Credit: credits, caps per day and month, validity, when exhausted. A preview line (« −20 % for 3 months, 100 uses, ends on … »). The economic terms are locked after the first use (a note says why). | `form`, `field`, `radio-group`, `switch`, `combobox`, `date-picker`, `tag-selector`, `alert`, **`money-input` (missing)** |
| Coupon detail | Terms, status, counts; redemptions table (account, status, amounts, credits, date, over-limit flag); revoke for credit redemptions; the audit trail | `data-table`, `stat`, `dialog`, `badge` |
| Partners | Table + create, edit, archive; the partner view per period (redemptions, discount given, revenue, credits, per coupon); export (Loi 25) | `data-table`, `stat`, `tabs`, `date-picker` |

### 6.2 The checkout field « Code promo »

| State | EN | FR |
|---|---|---|
| Label | Promo code | Code promo |
| Apply button | Apply | Appliquer |
| Applied | {code} applied: −{discount} {duration} | {code} appliqué : −{discount} {duration} |
| Remove | Remove | Retirer |
| Credit redeemed | {credits} credits added, valid until {date} | {credits} crédits ajoutés, valables jusqu'au {date} |
| `COUPON_UNKNOWN` | This code doesn't exist. Check the spelling. | Ce code n'existe pas. Vérifiez l'orthographe. |
| `COUPON_NOT_STARTED` | This code works from {date}. | Ce code est valable à partir du {date}. |
| `COUPON_EXPIRED` | This code ended on {date}. | Ce code a pris fin le {date}. |
| `COUPON_PAUSED` | This code is not available right now. | Ce code n'est pas disponible pour le moment. |
| `COUPON_EXHAUSTED` | This code has been used as many times as it can. | Ce code a atteint son nombre d'utilisations. |
| `COUPON_ACCOUNT_LIMIT` | You have already used this code. | Vous avez déjà utilisé ce code. |
| `COUPON_NEW_CUSTOMERS_ONLY` | This code is for new customers. | Ce code est réservé aux nouveaux clients. |
| `COUPON_NOT_FOR_PLAN` | This code doesn't apply to this plan. | Ce code ne s'applique pas à cette offre. |
| `COUPON_MINIMUM` | This code needs a purchase of at least {amount}. | Ce code demande un achat d'au moins {amount}. |
| `COUPON_CURRENCY`, `COUPON_KIND`, `COUPON_PROVIDER` | This code can't be used here. | Ce code ne peut pas être utilisé ici. |
| `COUPON_RATE_LIMITED` | Too many tries. Try again in {minutes} min. | Trop d'essais. Réessayez dans {minutes} min. |

The words live in each product's `messages/{en,fr}.json` under `coupons.*`, and the codes come from `@krizaka/coupons/contract`. The tax line under the total stays Stripe's (« before GST and QST » today, `messages/en.json:823` in Yomizaka).

### 6.3 The krizaka-ui issue (ready to file)

> **feat(ui): `PromoCodeField`, `MoneyInput` and `CopyButton`, for coupons (krizaka-ts#46)**
>
> - **`PromoCodeField`** (product-facing): an input and an « Apply » button, with these states:
>   - idle;
>   - checking (the button busy);
>   - applied (a `chip` with the effect and « Remove »);
>   - refused (the message under the field, `aria-describedby`, the input kept).
>
>   It is controlled: `onApply(code) → Promise<Result>`, `onRemove()`. The words come in through props. It reads correctly in dark and light, at 360 px, and with the keyboard (Enter applies), and it is announced (`aria-live="polite"`). It has a native twin (`@krizaka/ui/native`).
> - **`MoneyInput`**: an amount in minor units, plus a currency (`combobox`, ISO list passed in). It is formatted by locale (`@krizaka/intl`), refuses more than the currency's decimals, and its value is an integer.
> - **`CopyButton`**: copies a value (a generated code) and says « Copied » (`aria-live`). It reuses `code-block`'s copy logic.
> - **Tests:** a story and an a11y test for each. Their pages are generated on ui.krizaka.com.

## 7. Tests (phase 2)

| #46 asks for | Test |
|---|---|
| validity windows | `starts_at` and `ends_at` boundaries with an injected clock: one second before, at, and after |
| redemption limits, overall and per account | §2's counting rule: reserved-not-expired, confirmed and revoked count; released do not; a partial refund still counts; a full refund counts unless `refundRestoresUse` restored it; a deleted account's redemption still counts overall |
| concurrent redemption of the last use | two transactions `apply` the last use on PostgreSQL: one wins and the other gets `COUPON_EXHAUSTED`. Run 50 times. |
| the credit cap and its exhaustion | per day and per month in the configured time zone; `stop` and `fallback_paid`; expiry |
| an idempotent webhook | the same event twice changes nothing; two events with one `payment_ref` confirm once; a handler that throws leaves the event unrecorded, so a retry succeeds |
| tax on the discounted amount | the Stripe adapter sends `discounts` together with `automatic_tax` (the request body asserted, with a fake fetch). The `manual` provider's totals are computed on the discounted base (known numbers: 100,00 $ −20 % → base 80,00, GST 4,00, QST 7,98). |
| also | late payment after release → `released → confirmed`, `over_limit`; a crash between session and attach → the webhook finds the row by `redemption_id`; a fixed amount ≥ the bound → `COUPON_TOO_LARGE`, and a price drop pauses the coupon; partner erasure → no identifying column left; partner revenue net of refunds; refund with and without `refundRestoresUse`; terms locked after the first use; code normalisation (case, spaces); rate limit before lookup |

Every store test runs on the memory store and on PostgreSQL (CI's service, `@krizaka/db/testing`). The provider is a fake. No test touches the network.

## 8. The rollout: small PRs, each with its tests and acceptance

| # | Repository | PR | Acceptance |
|---|---|---|---|
| 1 | krizaka-ts | `payments` moves here; events applied in the effect's transaction; discount terms; `checkout_expired`, `payment_refunded`; amounts on events (ADR-001 cut #6) | Yomizaka's and Akinaza's flows unchanged (their tests green on the new version); the failing-handler test |
| 2 | krizaka-ts | `@krizaka/credits` (cut #7) | ledger, holds, caps; concurrency test |
| 3 | krizaka-ts | `@krizaka/coupons` | §7; README, generated docs, changeset |
| 4 | krizaka-ui | §6.3 | stories, a11y |
| 5 | yomizaka | adopt `payments`, then `credits` (`audit_credits` → ledger, behaviour unchanged), then `coupons`: credit coupons for audits (demos, support), discounts on Pro; admin screens | the existing `billing.integration.test.ts` stays green; a partner code bought end to end in Stripe test mode, by hand, before live |
| 6 | akinaza | adopt `payments` and `coupons`: discounts on the founder subscription, partner codes | the founder offer unchanged without a code |
| 7 | krizaka-billing (Java) + orazaka-web-client | the coupons twin: the same tables, codes and events; the credit coupon is a capped `GRANT`; console screens | a conformance suite shared with the TypeScript package (the same cases as data) |
| 8 | a former product | later: credit coupons on its ledger, when a former product moves to `credits` | — |

## 9. Open points

- **Retention of redemption records** with amounts: TO VALIDATE (Oussama, with the accountant).
- **Whether free credits granted through a coupon are a taxable supply** in Québec: TO VALIDATE (accountant). The design records them without money, and so without tax.
- **`coupons.maxPercentOff` default 50 %:** Oussama's call.
- **A partner code valid in several products:** each product has its own database, so it is one coupon per product with the same code, created in each console. A family-wide code would need a central service. Is that needed? (Oussama)
