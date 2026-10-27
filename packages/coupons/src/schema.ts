import { defineModule } from "@krizaka/db";

/**
 * The tables of « coupons » (ADR-002), in their own Postgres schema: `partner` (a person who sells for us: a name and an optional
 * e-mail, erasable), `coupon` (the code, its window, its limits and its terms: a discount or capped credits) and `redemption` (a use:
 * reserved, confirmed, released or revoked, with the amounts and the provider's references). The one product table referenced is the
 * owner (`owner`, the account table): a deleted account leaves its redemptions (`ON DELETE SET NULL`), because uses and revenue stay.
 * Version 1 is frozen once released: a change is version 2.
 */
export const couponsSchema = defineModule({
  module: "coupons",
  tables: ["owner"],
  migrations: [
    {
      version: 1,
      name: "partners, coupons and redemptions",
      sql: (c) => `
CREATE TABLE ${c.schema}.partner (
  id            uuid PRIMARY KEY,
  display_name  text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
  contact_email text CHECK (contact_email IS NULL OR contact_email = lower(contact_email)),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL,
  created_by    uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL,
  erased_at     timestamptz,
  CHECK (erased_at IS NOT NULL OR display_name IS NOT NULL),
  CHECK (erased_at IS NULL OR (display_name IS NULL AND contact_email IS NULL))
);
CREATE TABLE ${c.schema}.coupon (
  id                 uuid PRIMARY KEY,
  code               text NOT NULL CHECK (char_length(code) BETWEEN 4 AND 60),
  code_key           text NOT NULL UNIQUE CHECK (code_key = upper(code_key) AND char_length(code_key) BETWEEN 4 AND 40),
  kind               text NOT NULL CHECK (kind IN ('discount', 'credit')),
  purpose            text NOT NULL CHECK (purpose IN ('partner', 'promo', 'demo', 'support')),
  partner_id         uuid REFERENCES ${c.schema}.partner(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz,
  max_redemptions    integer CHECK (max_redemptions > 0),
  max_per_account    integer NOT NULL DEFAULT 1 CHECK (max_per_account > 0),
  new_customers_only boolean NOT NULL DEFAULT false,
  plans              text[] NOT NULL DEFAULT '{}',
  percent_off_bp     integer CHECK (percent_off_bp BETWEEN 1 AND 9999),
  amount_off_minor   integer CHECK (amount_off_minor > 0),
  currency           text CHECK (currency ~ '^[a-z]{3}$'),
  duration           text CHECK (duration IN ('once', 'repeating', 'forever')),
  duration_months    integer CHECK (duration_months BETWEEN 1 AND 36),
  minimum_minor      integer CHECK (minimum_minor >= 0),
  credits            integer CHECK (credits > 0),
  cap_per_day        integer CHECK (cap_per_day > 0),
  cap_per_month      integer CHECK (cap_per_month > 0),
  credits_valid_days integer CHECK (credits_valid_days > 0),
  on_exhausted       text CHECK (on_exhausted IN ('stop', 'fallback_paid')),
  terms_version      integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL,
  created_by         uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((purpose = 'partner') = (partner_id IS NOT NULL)),
  CHECK (kind <> 'discount' OR (credits IS NULL AND num_nonnulls(percent_off_bp, amount_off_minor) = 1
         AND (amount_off_minor IS NULL OR currency IS NOT NULL) AND duration IS NOT NULL
         AND ((duration = 'repeating') = (duration_months IS NOT NULL))
         AND (amount_off_minor IS NULL OR duration <> 'forever'))),
  CHECK (kind <> 'credit' OR (credits IS NOT NULL AND on_exhausted IS NOT NULL
         AND credits_valid_days IS NOT NULL
         AND num_nulls(percent_off_bp, amount_off_minor, duration) = 3))
);
CREATE INDEX coupon_partner ON ${c.schema}.coupon (partner_id) WHERE partner_id IS NOT NULL;
CREATE TABLE ${c.schema}.redemption (
  id                    uuid PRIMARY KEY,
  coupon_id             uuid NOT NULL REFERENCES ${c.schema}.coupon(id) ON DELETE RESTRICT,
  account_id            uuid REFERENCES ${c.tables.owner}(id) ON DELETE SET NULL,
  partner_id            uuid REFERENCES ${c.schema}.partner(id) ON DELETE SET NULL,
  status                text NOT NULL CHECK (status IN ('reserved', 'confirmed', 'released', 'revoked')),
  idempotency_key       text NOT NULL UNIQUE,
  reserved_until        timestamptz,
  checkout_ref          text UNIQUE,
  payment_ref           text UNIQUE,
  amount_paid_minor     bigint,
  amount_discount_minor bigint,
  amount_refunded_minor bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),
  use_restored          boolean NOT NULL DEFAULT false,
  currency              text,
  credit_grant_id       uuid,
  over_limit            boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL,
  confirmed_at          timestamptz,
  ended_at              timestamptz
);
CREATE INDEX redemption_uses ON ${c.schema}.redemption (coupon_id, account_id) WHERE status <> 'released' AND NOT use_restored;
CREATE INDEX redemption_reserved ON ${c.schema}.redemption (reserved_until) WHERE status = 'reserved';
CREATE INDEX redemption_partner ON ${c.schema}.redemption (partner_id, confirmed_at) WHERE partner_id IS NOT NULL;`,
    },
  ],
});
