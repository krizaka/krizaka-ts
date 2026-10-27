import { ident } from "@krizaka/db";

import {
  type Coupon,
  COUPON_ERROR,
  CouponError,
  type CouponPatch,
  type CouponStore,
  type Partner,
  type PartnerRow,
  type Query,
  type Redemption,
  type RedemptionPatch,
} from "./port";

type Row = Record<string, unknown>;
const n = (v: unknown): number => Number(v);
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const d = (v: unknown): Date => new Date(v as string | Date);
const dOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string | Date));

const toCoupon = (r: Row): Coupon => ({
  id: r.id as string, code: r.code as string, codeKey: r.code_key as string, kind: r.kind as Coupon["kind"], purpose: r.purpose as Coupon["purpose"], partnerId: (r.partner_id as string | null) ?? null,
  status: r.status as Coupon["status"], startsAt: d(r.starts_at), endsAt: dOrNull(r.ends_at), maxRedemptions: nOrNull(r.max_redemptions), maxPerAccount: n(r.max_per_account),
  newCustomersOnly: r.new_customers_only as boolean, plans: r.plans as string[], percentOffBp: nOrNull(r.percent_off_bp), amountOffMinor: nOrNull(r.amount_off_minor), currency: (r.currency as string | null) ?? null,
  duration: (r.duration as Coupon["duration"]) ?? null, durationMonths: nOrNull(r.duration_months), minimumMinor: nOrNull(r.minimum_minor), credits: nOrNull(r.credits), capPerDay: nOrNull(r.cap_per_day),
  capPerMonth: nOrNull(r.cap_per_month), creditsValidDays: nOrNull(r.credits_valid_days), onExhausted: (r.on_exhausted as Coupon["onExhausted"]) ?? null, termsVersion: n(r.terms_version),
  createdAt: d(r.created_at), createdBy: (r.created_by as string | null) ?? null, updatedAt: d(r.updated_at),
});

const toPartner = (r: Row): Partner => ({
  id: r.id as string, displayName: (r.display_name as string | null) ?? null, contactEmail: (r.contact_email as string | null) ?? null, status: r.status as Partner["status"],
  createdAt: d(r.created_at), createdBy: (r.created_by as string | null) ?? null, erasedAt: dOrNull(r.erased_at),
});

const toRedemption = (r: Row): Redemption => ({
  id: r.id as string, couponId: r.coupon_id as string, accountId: (r.account_id as string | null) ?? null, partnerId: (r.partner_id as string | null) ?? null, status: r.status as Redemption["status"],
  idempotencyKey: r.idempotency_key as string, reservedUntil: dOrNull(r.reserved_until), checkoutRef: (r.checkout_ref as string | null) ?? null, paymentRef: (r.payment_ref as string | null) ?? null,
  amountPaidMinor: nOrNull(r.amount_paid_minor), amountDiscountMinor: nOrNull(r.amount_discount_minor), amountRefundedMinor: n(r.amount_refunded_minor), useRestored: r.use_restored as boolean,
  currency: (r.currency as string | null) ?? null, creditGrantId: (r.credit_grant_id as string | null) ?? null, overLimit: r.over_limit as boolean, createdAt: d(r.created_at), confirmedAt: dOrNull(r.confirmed_at), endedAt: dOrNull(r.ended_at),
});

/** Field name to column, for the columns a patch may set. Nothing else ever reaches SQL text. */
const COUPON_COLUMNS: Record<keyof CouponPatch, string> = {
  code: "code", purpose: "purpose", partnerId: "partner_id", status: "status", startsAt: "starts_at", endsAt: "ends_at", maxRedemptions: "max_redemptions", maxPerAccount: "max_per_account", newCustomersOnly: "new_customers_only",
  plans: "plans", percentOffBp: "percent_off_bp", amountOffMinor: "amount_off_minor", currency: "currency", duration: "duration", durationMonths: "duration_months", minimumMinor: "minimum_minor", credits: "credits",
  capPerDay: "cap_per_day", capPerMonth: "cap_per_month", creditsValidDays: "credits_valid_days", onExhausted: "on_exhausted", termsVersion: "terms_version",
};
const REDEMPTION_COLUMNS: Record<keyof RedemptionPatch, string> = {
  status: "status", reservedUntil: "reserved_until", checkoutRef: "checkout_ref", paymentRef: "payment_ref", amountPaidMinor: "amount_paid_minor", amountDiscountMinor: "amount_discount_minor",
  amountRefundedMinor: "amount_refunded_minor", useRestored: "use_restored", currency: "currency", creditGrantId: "credit_grant_id", overLimit: "over_limit", confirmedAt: "confirmed_at", endedAt: "ended_at",
};
const PARTNER_COLUMNS = { displayName: "display_name", contactEmail: "contact_email", status: "status", erasedAt: "erased_at" } as const;

/** `col = $n, …` and the values, for the keys of `patch` that are set (a key with `undefined` is left alone). */
function setClause(patch: Record<string, unknown>, columns: Record<string, string>, first: number): { sql: string; values: unknown[] } {
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined && key in columns);
  return { sql: keys.map((key, i) => `${columns[key]} = $${first + i}`).join(", "), values: keys.map((key) => patch[key]) };
}

const COUNTS = `((status IN ('confirmed', 'revoked') AND NOT use_restored) OR (status = 'reserved' AND reserved_until > $NOW))`;

/**
 * The PostgreSQL store of coupons, in schema `coupons` (see `couponsSchema`), over the `Query` it is given: the caller's
 * transaction, so the work commits or rolls back with the product's. `couponByKey(…, true)` is `SELECT … FOR UPDATE`: the last use of a
 * code is taken by one request at a time. The guarded transition of `updateRedemption` is one `UPDATE … WHERE status = ANY(…)`.
 * Times come from the caller (the injected clock), never from the database's `now()`.
 * @param schema the Postgres schema of the module, default `coupons`
 */
export function dbCouponStore(query: Query, schema = "coupons"): CouponStore {
  const s = ident(schema);
  const coupon = `${s}.coupon`;
  const partner = `${s}.partner`;
  const redemption = `${s}.redemption`;
  return {
    async insertCoupon(c) {
      try {
        await query(
          `INSERT INTO ${coupon} (id, code, code_key, kind, purpose, partner_id, status, starts_at, ends_at, max_redemptions, max_per_account, new_customers_only, plans, percent_off_bp, amount_off_minor, currency, duration, duration_months, minimum_minor, credits, cap_per_day, cap_per_month, credits_valid_days, on_exhausted, terms_version, created_at, created_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
          [c.id, c.code, c.codeKey, c.kind, c.purpose, c.partnerId, c.status, c.startsAt, c.endsAt, c.maxRedemptions, c.maxPerAccount, c.newCustomersOnly, c.plans, c.percentOffBp, c.amountOffMinor, c.currency, c.duration, c.durationMonths, c.minimumMinor, c.credits, c.capPerDay, c.capPerMonth, c.creditsValidDays, c.onExhausted, c.termsVersion, c.createdAt, c.createdBy, c.updatedAt],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new CouponError(COUPON_ERROR.codeTaken, "This code is already used");
        throw error;
      }
    },
    async couponById(id, forUpdate = false) {
      const [row] = await query<Row>(`SELECT * FROM ${coupon} WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return row ? toCoupon(row) : null;
    },
    async couponByKey(codeKey, forUpdate = false) {
      const [row] = await query<Row>(`SELECT * FROM ${coupon} WHERE code_key = $1${forUpdate ? " FOR UPDATE" : ""}`, [codeKey]);
      return row ? toCoupon(row) : null;
    },
    async updateCoupon(id, patch, at) {
      const set = setClause(patch, COUPON_COLUMNS, 3);
      const [row] = await query<Row>(`UPDATE ${coupon} SET ${set.sql ? `${set.sql}, ` : ""}updated_at = $2 WHERE id = $1 RETURNING *`, [id, at, ...set.values]);
      return row ? toCoupon(row) : null;
    },
    async listCoupons(f) {
      const rows = await query<Row>(
        `SELECT * FROM ${coupon} WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR purpose = $3) AND ($4::uuid IS NULL OR partner_id = $4)
          ORDER BY created_at DESC, id LIMIT $5 OFFSET $6`,
        [f.status ?? null, f.kind ?? null, f.purpose ?? null, f.partnerId ?? null, f.limit, f.offset],
      );
      return rows.map(toCoupon);
    },
    async hasRedemptions(couponId) {
      return (await query(`SELECT 1 FROM ${redemption} WHERE coupon_id = $1 LIMIT 1`, [couponId])).length > 0;
    },
    async insertPartner(p) {
      await query(`INSERT INTO ${partner} (id, display_name, contact_email, status, created_at, created_by, erased_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [p.id, p.displayName, p.contactEmail, p.status, p.createdAt, p.createdBy, p.erasedAt]);
    },
    async partnerById(id) {
      const [row] = await query<Row>(`SELECT * FROM ${partner} WHERE id = $1`, [id]);
      return row ? toPartner(row) : null;
    },
    async updatePartner(id, patch) {
      const set = setClause(patch, PARTNER_COLUMNS, 2);
      if (!set.sql) return (await this.partnerById(id)) ?? null;
      const [row] = await query<Row>(`UPDATE ${partner} SET ${set.sql} WHERE id = $1 RETURNING *`, [id, ...set.values]);
      return row ? toPartner(row) : null;
    },
    async listPartners(o) {
      const rows = await query<Row>(`SELECT * FROM ${partner} WHERE ($1 OR status = 'active') ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`, [o.includeArchived, o.limit, o.offset]);
      return rows.map(toPartner);
    },
    async insertRedemption(r) {
      await query(
        `INSERT INTO ${redemption} (id, coupon_id, account_id, partner_id, status, idempotency_key, reserved_until, checkout_ref, payment_ref, amount_paid_minor, amount_discount_minor, amount_refunded_minor, use_restored, currency, credit_grant_id, over_limit, created_at, confirmed_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [r.id, r.couponId, r.accountId, r.partnerId, r.status, r.idempotencyKey, r.reservedUntil, r.checkoutRef, r.paymentRef, r.amountPaidMinor, r.amountDiscountMinor, r.amountRefundedMinor, r.useRestored, r.currency, r.creditGrantId, r.overLimit, r.createdAt, r.confirmedAt, r.endedAt],
      );
    },
    async redemptionById(id) {
      const [row] = await query<Row>(`SELECT * FROM ${redemption} WHERE id = $1`, [id]);
      return row ? toRedemption(row) : null;
    },
    async redemptionByKey(key) {
      const [row] = await query<Row>(`SELECT * FROM ${redemption} WHERE idempotency_key = $1`, [key]);
      return row ? toRedemption(row) : null;
    },
    async redemptionByCheckoutRef(ref) {
      const [row] = await query<Row>(`SELECT * FROM ${redemption} WHERE checkout_ref = $1`, [ref]);
      return row ? toRedemption(row) : null;
    },
    async redemptionByPaymentRef(ref) {
      const [row] = await query<Row>(`SELECT * FROM ${redemption} WHERE payment_ref = $1`, [ref]);
      return row ? toRedemption(row) : null;
    },
    async updateRedemption(id, from, patch) {
      const set = setClause(patch, REDEMPTION_COLUMNS, 3);
      const [row] = await query<Row>(`UPDATE ${redemption} SET ${set.sql} WHERE id = $1 AND ($2::text[] IS NULL OR status = ANY($2::text[])) RETURNING *`, [id, from ? [...from] : null, ...set.values]);
      return row ? toRedemption(row) : null;
    },
    async usage(couponId, accountId, now) {
      const counted = COUNTS.replaceAll("$NOW", () => "$3");
      const [row] = await query<{ total: number; account: number }>(
        `SELECT count(*) FILTER (WHERE ${counted})::int AS total, count(*) FILTER (WHERE ${counted} AND account_id = $2)::int AS account FROM ${redemption} WHERE coupon_id = $1`,
        [couponId, accountId, now],
      );
      return { total: row?.total ?? 0, account: row?.account ?? 0 };
    },
    async listRedemptions(f) {
      const rows = await query<Row>(
        `SELECT r.* FROM ${redemption} r
          WHERE ($1::uuid IS NULL OR r.coupon_id = $1) AND ($2::uuid IS NULL OR r.partner_id = $2) AND ($3::text IS NULL OR r.status = $3)
            AND ($4::timestamptz IS NULL OR r.created_at >= $4) AND ($5::timestamptz IS NULL OR r.created_at < $5)
          ORDER BY r.created_at DESC, r.id LIMIT $6 OFFSET $7`,
        [f.couponId ?? null, f.partnerId ?? null, f.status ?? null, f.from ?? null, f.to ?? null, f.limit, f.offset],
      );
      return rows.map(toRedemption);
    },
    async releaseExpired(now, limit) {
      const rows = await query<Row>(
        `UPDATE ${redemption} SET status = 'released', reserved_until = NULL, ended_at = $1
          WHERE id IN (SELECT id FROM ${redemption} WHERE status = 'reserved' AND reserved_until <= $1 ORDER BY reserved_until, id LIMIT $2 FOR UPDATE SKIP LOCKED)
          RETURNING *`,
        [now, limit],
      );
      return rows.map(toRedemption);
    },
    async partnerReport(partnerId, period, now): Promise<PartnerRow[]> {
      const rows = await query<Row>(
        `SELECT c.id AS coupon_id, c.code, r.currency,
                count(*)::int AS redemptions,
                COALESCE(sum(r.amount_discount_minor), 0) AS discount,
                COALESCE(sum(COALESCE(r.amount_paid_minor, 0) - r.amount_refunded_minor), 0) AS revenue,
                COALESCE(sum(CASE WHEN c.kind = 'credit' THEN c.credits ELSE 0 END), 0) AS credits_granted
           FROM ${redemption} r JOIN ${coupon} c ON c.id = r.coupon_id
          WHERE r.partner_id = $1
            AND ((r.status IN ('confirmed', 'revoked') AND NOT r.use_restored) OR (r.status = 'reserved' AND r.reserved_until > $2))
            AND ($3::timestamptz IS NULL OR COALESCE(r.confirmed_at, r.created_at) >= $3) AND ($4::timestamptz IS NULL OR COALESCE(r.confirmed_at, r.created_at) < $4)
          GROUP BY c.id, c.code, r.currency ORDER BY c.code, r.currency NULLS FIRST`,
        [partnerId, now, period.from ?? null, period.to ?? null],
      );
      return rows.map((r) => ({ couponId: r.coupon_id as string, code: r.code as string, currency: (r.currency as string | null) ?? null, redemptions: n(r.redemptions), discountMinor: n(r.discount), revenueMinor: n(r.revenue), creditsGranted: n(r.credits_granted) }));
    },
    async activeAmountCoupons() {
      return (await query<Row>(`SELECT * FROM ${coupon} WHERE status = 'active' AND amount_off_minor IS NOT NULL ORDER BY created_at, id`)).map(toCoupon);
    },
  };
}
