# ADR-002: Coupons: discount and credit coupons the admin manages, with our database as the source of truth

- **Status:** proposed (2026-10-23). It waits for the CTO's « validé » on krizaka/krizaka-ts#46.
- **Issue:** krizaka/krizaka-ts#46. It depends on the module map of krizaka/krizaka-ts#47 ([ADR-001](ADR-001-modular-architecture.md), PR #48) and on #34 (payments).
- **Design:** [`docs/design/coupons.md`](../design/coupons.md) holds the inventory with file:line, the schema, the API, the admin and UI side, and the rollout.

## Context

Oussama (2026-10-23) wants coupons that the admin creates, with a start and an end date, for three uses:
- people who sell for us (partners);
- discounts;
- demos.

There are two kinds. A **discount** coupon reduces a price at checkout. A **credit** coupon grants usage and **must** carry a cap. A free coupon is a credit coupon, never an unlimited discount. This evolves what exists; it is not a second billing system.

What exists, read in the products on 2026-10-23 (details and file:line in the design, §1):
- **No product has coupons, promo codes or discounts.**
- **Yomizaka and Akinaza** pay through `@krizaka/payments` 0.1.0, a Stripe adapter without the SDK.
  - Prices are Stripe prices found by lookup key.
  - Taxes are Stripe Tax: `automatic_tax`, `tax_id_collection` (krizaka-ui `packages/payments/src/stripe.ts:137-151`).
  - Entitlements are columns on `accounts`, written by each product's own `billing.ts`.
  - Akinaza's 39 $ founder offer is a price, not a coupon.
- **Orochia** has its own payment package with five gateways, and an append-only credit ledger in cents, with holds.
- **Orazaka's** credits live in the Java `krizaka-billing`: `GRANTED` and `PURCHASED` buckets, holds, an idempotency key per entry. It has no payment provider at all.
- **The idempotency gap.** `@krizaka/payments`' `applyOnce` records a webhook's id before its handler runs, and not in the same transaction (`events.ts:15-21`). A coupon redeemed there could be lost (the handler fails after the id is recorded) or double-counted (a retry with a new event id).

## Decision: option B, our own `@krizaka/coupons`, with the provider as an adapter

1. **The product's database is the source of truth** for coupons, partners and redemptions.
   - The coupons live in the Postgres schema `coupons`, one per product database (ADR-001 §3).
   - The admin creates, pauses and ends them in the product's console.
   - Every change is audited (`@krizaka/audit`), and every knob is a setting.
2. **Discount coupons are applied by the payment provider at checkout, from our terms.**
   - Our module validates the code and **reserves** a use under a row lock. It hands the payments port immutable **discount terms**: percent or amount, currency, duration, months.
   - The Stripe adapter turns those terms into a Stripe coupon, created **once per terms version** and remembered by `@krizaka/payments`. It passes the coupon as `discounts: [{ coupon }]` on the Checkout Session; Stripe accepts one coupon per session.
   - We **never create Stripe promotion codes.** The code a person types exists only in our database. Our limits and our rate limits apply, and Stripe holds no second truth.
   - Stripe Tax computes the tax **after** the discount: « Stripe Tax calculates tax after applying discounts to the subtotal » (docs.stripe.com/tax/calculating, « Discounts and tax calculations », read 2026-10-23). So GST and QST are on the discounted amount, with no code of ours.
   - The `manual` provider (#34: on site, invoice later) applies the same terms as a line discount before tax, as Akinaza's invoices already do (`discountCents`, `packages/core/src/tax.ts:69-74`).
3. **Credit coupons are ours alone.**
   - Redeeming one grants credits in `@krizaka/credits`, the ledger of ADR-001's module map, which follows `krizaka-billing`'s model.
   - Every grant carries:
     - the credits granted (required);
     - an optional cap per day and per month;
     - an expiry (required: `credits_valid_days`);
     - what happens when it runs out: `stop` (refuse with a typed code), or `fallback_paid` (the product shows its paid plan).
   - No provider is involved, so a credit coupon works with every provider, including Orochia's gateways.
4. **Redemptions are reserved, confirmed and released, in transactions.**
   - **Reserve at checkout.** `apply` locks the coupon row (`SELECT … FOR UPDATE`) in a short transaction. It counts the uses (the design's §2 rule), overall and for the account, inserts a `reserved` redemption with an expiry, and commits. `apply` is idempotent by its key.
   - **No network call happens under the lock or inside a transaction.** The provider's session is created afterwards with the redemption id as its idempotency key, and attached in a second short transaction. The webhook finds the redemption by `metadata.redemption_id` even if the attach never ran (design §4.1).
   - **Confirm on the payment webhook.** `redeem` runs **in the same transaction** as the payment event's idempotency record (cut #6 of ADR-001 makes `@krizaka/payments` do this). Its guarded transition is `UPDATE … WHERE status IN ('reserved', 'released')`: `released` is allowed so that a late payment can still be confirmed. A unique payment reference means it can never be confirmed twice.
   - **Release.** `checkout.session.expired`, or the sweeper, releases unpaid reservations.
   - **A late payment is honoured.** When the provider has already charged the discounted price, the redemption is confirmed even if its reservation expired or the coupon ran out meanwhile. It is flagged `over_limit` and audited, because the customer paid in good faith.
5. **Partners are a small record.**
   - A partner has a display name, an optional contact e-mail and a status.
   - A partner owns coupons. The admin sees each partner's redemptions, discounts given and revenue.
   - Commission is **out of scope**. The hook is `evt.coupon.redeemed.v1`, which carries the partner id and the amounts paid, for a later commission module to consume.
6. **The existing billing code moves into shared packages first, in this order:**
   1. `@krizaka/payments` moves to krizaka-ts (ADR-001 cut #6). Its webhook events are applied in the effect's transaction; it gains discount terms on checkout, and the `checkout_expired` and `payment_refunded` events. The copied `payment_events` migration (Yomizaka 0009, Akinaza 0010) becomes the module's, adopted.
   2. The three copied routes (checkout, portal, webhook) become route handlers of the package.
   3. The subscription state on `accounts` (four columns × two products) becomes `payments.subscription`, adopted.
   4. Yomizaka's `audit_credits` / free-audit logic moves to `@krizaka/credits` (ADR-001 cut #7), with its behaviour unchanged.
   5. Then comes `@krizaka/coupons`.
   6. Orochia keeps its own credits and gateways until a later move. Orazaka's credits stay in Java (§7).
7. **Orazaka gets the same model in Java.** Orazaka's billing is `krizaka-billing`; the web client has no database. Its coupons are therefore a twin in `krizaka-billing`, with the same tables, refusal codes and events. Its credit coupon is a `GRANT` with the cap. This is filed as a Java issue after the TypeScript package proves the model.

## The options weighed

| Criterion | A. Provider-native (Stripe Coupons and Promotion Codes, driven from our admin) | **B. Our module, provider as an adapter (chosen)** | C. Mix: discounts mirrored to the provider, credit coupons ours |
|---|---|---|---|
| The admin configures, our database is the truth | No: Stripe holds the codes, limits and redemptions; we mirror them back | **Yes** | Half: discount codes live in two places that must be kept in sync (pause, end, limits) |
| Credit coupons | Impossible: Stripe has no notion of our usage credits | **Yes** | Yes |
| Portability across providers | None: Orochia's CCBill and Segpay have no coupon API; `manual` has no Stripe | **Yes**: discount terms are vendor-free; a provider without discounts refuses them with a typed code; credit coupons work everywhere | Discounts tied to Stripe |
| Taxes (TPS/TVQ on the discounted amount) | Yes (Stripe Tax) | **Yes**: Stripe Tax for Stripe; a line discount before tax for `manual` | Yes |
| Per-account limits, new customers only | Partial: `first_time_transaction` and per-customer codes only; no « N per account » | **Yes**, in SQL under a row lock | Partial for discounts |
| Concurrency (two people, the last use) | Stripe's `max_redemptions`, counted at payment: oversell between session and payment | **Reservation under lock**; late payments honoured and flagged | Stripe's again for discounts |
| Abuse (brute-forcing codes) | Stripe's field on its page, with no rate limit of ours | **Our rate limits** (`@krizaka/rate-limit`, settings) before any lookup | Split |
| Refunds | Stripe's | Stripe refunds the amount paid; the redemption keeps its status and records the refunded amount (cumulative); only a full refund with the setting on gives the use back | Split |
| Partner attribution, Loi 25 | Partner data in Stripe metadata, outside our register | **In our database**, admin-only, exportable and erasable | Split |
| Testable without network | No (Stripe test mode is the network) | **Yes**: memory store, a fake provider, PostgreSQL on CI | Partly |

**C was rejected:** it keeps two truths for discounts, and every pause, end or limit must be synchronised. **B already gets C's real benefit,** which is Stripe computing taxes and subscription durations, by passing a provider coupon object at checkout, never a code.

## Consequences and costs

- **The order is longer before the first coupon:** `payments` moved and made transactional, then `credits`, then `coupons`. This order also fixes the idempotency gap for every payment, coupon or not, and gives Yomizaka one ledger instead of columns.
- **Discount terms are immutable once used.** After a coupon's first redemption, the admin cannot change its percent, amount, currency or duration, only its window, limits, status and partner. A new offer is a new coupon. This keeps the Stripe coupon cache valid and the history readable.
- **Stripe coupons pile up slowly:** one per terms version, never one per checkout.
- **A provider that cannot apply discounts** (CCBill, Segpay) makes discount coupons unavailable there, said by a typed refusal (`COUPON_PROVIDER`). Credit coupons are unaffected.
- **Revealing the refusal reason** (expired, not started) tells a caller that a code exists. The rate limits make that a slow, logged search. The reasons are what makes the checkout field useful.
- **No environment variable is added.** The provider keys stay `PAYMENTS_*`, as today. Everything else is a setting (`coupons.*`) the admin edits.
