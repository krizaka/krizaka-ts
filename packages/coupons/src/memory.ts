import { type Coupon, COUPON_STATUS, type CouponStore, KIND, type Partner, type PartnerRow, type Redemption, REDEMPTION_STATUS } from "./port";
import { countsAsUse } from "./rules";

const PARTNER_ACTIVE: Partner["status"] = "active";
const clone = <T extends object>(v: T): T => ({ ...v });

/**
 * An in-memory store, for unit tests and demos: the same behaviour as the database's (the contract kit runs on both) except that
 * `forUpdate` locks nothing, because it has no transaction to hold a lock in. Concurrency is proved on PostgreSQL.
 */
export function memoryCouponStore(): CouponStore {
  const coupons = new Map<string, Coupon>();
  const partners = new Map<string, Partner>();
  const redemptions = new Map<string, Redemption>();
  const unique = (field: "idempotencyKey" | "checkoutRef" | "paymentRef", value: string | null, except: string) => {
    if (value !== null && [...redemptions.values()].some((r) => r.id !== except && r[field] === value)) throw new Error(`duplicate ${field}`);
  };
  const page = <T>(rows: T[], limit: number, offset: number) => rows.slice(offset, offset + limit);
  const newestFirst = <T extends { createdAt: Date; id: string }>(rows: T[]) => rows.sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf() || a.id.localeCompare(b.id));
  return {
    async insertCoupon(c) {
      if ([...coupons.values()].some((x) => x.codeKey === c.codeKey)) throw Object.assign(new Error("duplicate code_key"), { code: "23505" });
      coupons.set(c.id, clone(c));
    },
    async couponById(id) {
      const c = coupons.get(id);
      return c ? clone(c) : null;
    },
    async couponByKey(codeKey) {
      const c = [...coupons.values()].find((x) => x.codeKey === codeKey);
      return c ? clone(c) : null;
    },
    async updateCoupon(id, patch, at) {
      const c = coupons.get(id);
      if (!c) return null;
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) (c as unknown as Record<string, unknown>)[key] = value;
      c.updatedAt = at;
      return clone(c);
    },
    async listCoupons(f) {
      const rows = [...coupons.values()].filter((c) => (!f.status || c.status === f.status) && (!f.kind || c.kind === f.kind) && (!f.purpose || c.purpose === f.purpose) && (!f.partnerId || c.partnerId === f.partnerId));
      return page(newestFirst(rows), f.limit, f.offset).map(clone);
    },
    async hasRedemptions(couponId) {
      return [...redemptions.values()].some((r) => r.couponId === couponId);
    },
    async insertPartner(p) {
      partners.set(p.id, clone(p));
    },
    async partnerById(id) {
      const p = partners.get(id);
      return p ? clone(p) : null;
    },
    async updatePartner(id, patch) {
      const p = partners.get(id);
      if (!p) return null;
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) (p as unknown as Record<string, unknown>)[key] = value;
      return clone(p);
    },
    async listPartners(o) {
      return page(newestFirst([...partners.values()].filter((p) => o.includeArchived || p.status === PARTNER_ACTIVE)), o.limit, o.offset).map(clone);
    },
    async insertRedemption(r) {
      unique("idempotencyKey", r.idempotencyKey, r.id);
      unique("checkoutRef", r.checkoutRef, r.id);
      unique("paymentRef", r.paymentRef, r.id);
      redemptions.set(r.id, clone(r));
    },
    async redemptionById(id) {
      const r = redemptions.get(id);
      return r ? clone(r) : null;
    },
    async redemptionByKey(key) {
      const r = [...redemptions.values()].find((x) => x.idempotencyKey === key);
      return r ? clone(r) : null;
    },
    async redemptionByCheckoutRef(ref) {
      const r = [...redemptions.values()].find((x) => x.checkoutRef === ref);
      return r ? clone(r) : null;
    },
    async redemptionByPaymentRef(ref) {
      const r = [...redemptions.values()].find((x) => x.paymentRef === ref);
      return r ? clone(r) : null;
    },
    async updateRedemption(id, from, patch) {
      const r = redemptions.get(id);
      if (!r || (from && !from.includes(r.status))) return null;
      unique("checkoutRef", patch.checkoutRef ?? null, id);
      unique("paymentRef", patch.paymentRef ?? null, id);
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) (r as unknown as Record<string, unknown>)[key] = value;
      return clone(r);
    },
    async usage(couponId, accountId, now) {
      const live = [...redemptions.values()].filter((r) => r.couponId === couponId && countsAsUse(r, now));
      return { total: live.length, account: accountId === null ? 0 : live.filter((r) => r.accountId === accountId).length };
    },
    async listRedemptions(f) {
      const rows = [...redemptions.values()].filter((r) => (!f.couponId || r.couponId === f.couponId) && (!f.partnerId || r.partnerId === f.partnerId) && (!f.status || r.status === f.status) && (!f.from || r.createdAt >= f.from) && (!f.to || r.createdAt < f.to));
      return page(newestFirst(rows), f.limit, f.offset).map(clone);
    },
    async releaseExpired(now, limit) {
      const due = [...redemptions.values()].filter((r) => r.status === REDEMPTION_STATUS.reserved && r.reservedUntil !== null && r.reservedUntil <= now).sort((a, b) => a.reservedUntil!.valueOf() - b.reservedUntil!.valueOf() || a.id.localeCompare(b.id)).slice(0, limit);
      for (const r of due) Object.assign(r, { status: REDEMPTION_STATUS.released, reservedUntil: null, endedAt: now });
      return due.map(clone);
    },
    async partnerReport(partnerId, period, now): Promise<PartnerRow[]> {
      const rows = new Map<string, PartnerRow>();
      for (const r of redemptions.values()) {
        const at = r.confirmedAt ?? r.createdAt;
        if (r.partnerId !== partnerId || !countsAsUse(r, now) || (period.from && at < period.from) || (period.to && at >= period.to)) continue;
        const c = coupons.get(r.couponId)!;
        const key = `${c.id}|${r.currency ?? ""}`;
        const row = rows.get(key) ?? { couponId: c.id, code: c.code, currency: r.currency, redemptions: 0, discountMinor: 0, revenueMinor: 0, creditsGranted: 0 };
        row.redemptions += 1;
        row.discountMinor += r.amountDiscountMinor ?? 0;
        row.revenueMinor += (r.amountPaidMinor ?? 0) - r.amountRefundedMinor;
        row.creditsGranted += c.kind === KIND.credit ? (c.credits ?? 0) : 0;
        rows.set(key, row);
      }
      return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code) || (a.currency ?? "").localeCompare(b.currency ?? ""));
    },
    async activeAmountCoupons() {
      return [...coupons.values()].filter((c) => c.status === COUPON_STATUS.active && c.amountOffMinor !== null).sort((a, b) => a.createdAt.valueOf() - b.createdAt.valueOf() || a.id.localeCompare(b.id)).map(clone);
    },
  };
}
