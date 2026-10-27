import { type Kernel, SYSTEM } from "./kernel";
import {
  type Actor,
  type Coupon,
  COUPON_ERROR,
  COUPON_STATUS,
  CouponError,
  type CouponFilter,
  type CouponPatch,
  type Partner,
  type PartnerRow,
  type Query,
  type Redemption,
  type RedemptionFilter,
} from "./port";
import { checkCoupon, generateCode, type NewCoupon, normalizeCode } from "./rules";

const bad = (message: string) => new CouponError(COUPON_ERROR.badInput, message);
// @fixed: a page of the admin's lists
const PAGE = 50;
// @fixed: the most rows one admin list returns
const MAX_PAGE = 200;
// @fixed: tries at a generated code that is free (the alphabet has 32^8 or more codes)
const CODE_TRIES = 5;

/** The fields that are a coupon's TERMS: locked once anyone has used the coupon (the provider's object is made from them, per version). */
const TERMS = ["percentOffBp", "amountOffMinor", "currency", "duration", "durationMonths", "credits", "capPerDay", "capPerMonth", "creditsValidDays", "onExhausted"] as const;

const page = (limit: number | undefined, offset: number | undefined) => ({ limit: Math.min(Math.max(limit ?? PAGE, 1), MAX_PAGE), offset: Math.max(offset ?? 0, 0) });

export interface PartnerInput {
  displayName: string;
  contactEmail?: string | null;
}

/** The admin's side (ADR-002 §6): coupons and partners, every change audited in the caller's transaction. */
export function makeAdmin(k: Kernel) {
  const must = async <T>(found: Promise<T | null>, code: typeof COUPON_ERROR.notFound | typeof COUPON_ERROR.partnerNotFound, what: string): Promise<T> => {
    const value = await found;
    if (!value) throw new CouponError(code, what);
    return value;
  };
  const partnerOk = async (tx: Query, partnerId: string | null | undefined) => {
    if (partnerId) await must(k.store(tx).partnerById(partnerId), COUPON_ERROR.partnerNotFound, `No partner ${partnerId}`);
  };

  async function generateFreeCode(query: Query): Promise<string> {
    const length = (await k.settings()).generatedCodeLength;
    for (let i = 0; i < CODE_TRIES; i += 1) {
      const code = generateCode(length);
      if (!(await k.store(query).couponByKey(code))) return code;
    }
    throw bad("Could not find a free code, try again");
  }

  async function create(tx: Query, actor: Actor, input: NewCoupon): Promise<Coupon> {
    const settings = await k.settings();
    checkCoupon(input, settings);
    const codeKey = normalizeCode(input.code)!;
    const store = k.store(tx);
    if (await store.couponByKey(codeKey)) throw new CouponError(COUPON_ERROR.codeTaken, "This code is already used");
    await partnerOk(tx, input.partnerId);
    const now = k.now();
    const coupon: Coupon = {
      id: k.newId(), code: input.code.trim(), codeKey, kind: input.kind, purpose: input.purpose, partnerId: input.partnerId ?? null, status: COUPON_STATUS.active,
      startsAt: input.startsAt, endsAt: input.endsAt ?? null, maxRedemptions: input.maxRedemptions ?? null, maxPerAccount: input.maxPerAccount ?? 1, newCustomersOnly: input.newCustomersOnly ?? false, plans: input.plans ?? [],
      percentOffBp: input.percentOffBp ?? null, amountOffMinor: input.amountOffMinor ?? null, currency: input.currency ?? null, duration: input.duration ?? null, durationMonths: input.durationMonths ?? null, minimumMinor: input.minimumMinor ?? null,
      credits: input.credits ?? null, capPerDay: input.capPerDay ?? null, capPerMonth: input.capPerMonth ?? null, creditsValidDays: input.creditsValidDays ?? null, onExhausted: input.onExhausted ?? null,
      termsVersion: 1, createdAt: now, createdBy: actor.id, updatedAt: now,
    };
    await store.insertCoupon(coupon);
    await k.record(tx, actor, "coupon.created", { type: "coupon", id: coupon.id }, { code: coupon.code, kind: coupon.kind, purpose: coupon.purpose, partnerId: coupon.partnerId });
    return coupon;
  }

  async function update(tx: Query, actor: Actor, id: string, patch: CouponPatch): Promise<Coupon> {
    const store = k.store(tx);
    const before = await must(store.couponById(id, true), COUPON_ERROR.notFound, `No coupon ${id}`);
    const changed = (Object.keys(patch) as (keyof CouponPatch)[]).filter((key) => patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(before[key]));
    if (changed.length === 0) return before;
    if (changed.some((key) => (TERMS as readonly string[]).includes(key)) && (await store.hasRedemptions(id))) throw new CouponError(COUPON_ERROR.termsLocked, "The terms of a coupon that has been used are locked: make a new coupon");
    const next = { ...before, ...patch };
    checkCoupon(next, await k.settings());
    await partnerOk(tx, patch.partnerId);
    const after = (await store.updateCoupon(id, patch, k.now()))!;
    await k.record(tx, actor, "coupon.updated", { type: "coupon", id }, { changed, before: Object.fromEntries(changed.map((key) => [key, before[key]])), after: Object.fromEntries(changed.map((key) => [key, after[key]])) });
    return after;
  }

  async function setStatus(tx: Query, actor: Actor, id: string, status: Coupon["status"], action: string): Promise<Coupon> {
    const store = k.store(tx);
    const before = await must(store.couponById(id, true), COUPON_ERROR.notFound, `No coupon ${id}`);
    if (before.status === status) return before;
    if (before.status === COUPON_STATUS.archived) throw bad("An archived coupon stays archived");
    const after = (await store.updateCoupon(id, { status }, k.now()))!;
    await k.record(tx, actor, action, { type: "coupon", id }, { from: before.status, to: status });
    return after;
  }

  /** Pauses the live fixed-amount coupons that a price drop would make too large (the bound `coupons.maxPercentOff`); answers their ids. */
  async function checkPrices(tx: Query, prices: readonly { plan: string; amountMinor: number; currency: string }[]): Promise<string[]> {
    const { maxPercentOff } = await k.settings();
    const paused: string[] = [];
    for (const c of await k.store(tx).activeAmountCoupons()) {
      const applicable = prices.filter((p) => p.currency === c.currency && (c.plans.length === 0 || c.plans.includes(p.plan)));
      if (!applicable.some((p) => c.amountOffMinor! * 100 > p.amountMinor * maxPercentOff)) continue;
      await k.store(tx).updateCoupon(c.id, { status: COUPON_STATUS.paused }, k.now());
      await k.record(tx, SYSTEM, "coupon.paused_by_price", { type: "coupon", id: c.id }, { maxPercentOff });
      paused.push(c.id);
    }
    return paused;
  }

  async function createPartner(tx: Query, actor: Actor, input: PartnerInput): Promise<Partner> {
    const name = input.displayName.trim();
    const email = input.contactEmail?.trim().toLowerCase() || null;
    if (name.length < 1 || name.length > 80) throw bad("A partner has a display name of 1 to 80 characters");
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("A contact e-mail looks like a@b.c");
    const partner: Partner = { id: k.newId(), displayName: name, contactEmail: email, status: "active", createdAt: k.now(), createdBy: actor.id, erasedAt: null };
    await k.store(tx).insertPartner(partner);
    await k.record(tx, actor, "partner.created", { type: "partner", id: partner.id }, {});
    return partner;
  }

  async function setPartnerStatus(tx: Query, actor: Actor, id: string, status: Partner["status"]): Promise<Partner> {
    await must(k.store(tx).partnerById(id), COUPON_ERROR.partnerNotFound, `No partner ${id}`);
    const after = (await k.store(tx).updatePartner(id, { status }))!;
    await k.record(tx, actor, `partner.${status === "active" ? "restored" : "archived"}`, { type: "partner", id }, {});
    return after;
  }

  /** Loi 25: blanks the name and the e-mail and keeps the aggregates (the redemptions are accounting records). */
  async function erasePartner(tx: Query, actor: Actor, id: string): Promise<Partner> {
    const partner = await must(k.store(tx).partnerById(id), COUPON_ERROR.partnerNotFound, `No partner ${id}`);
    if (partner.erasedAt) return partner;
    const after = (await k.store(tx).updatePartner(id, { displayName: null, contactEmail: null, status: "archived", erasedAt: k.now() }))!;
    await k.record(tx, actor, "partner.erased", { type: "partner", id }, {});
    return after;
  }

  /** Loi 25: the partner's record and its aggregates. */
  async function exportPartner(query: Query, id: string): Promise<{ partner: Partner; rows: PartnerRow[] }> {
    const partner = await must(k.store(query).partnerById(id), COUPON_ERROR.partnerNotFound, `No partner ${id}`);
    return { partner, rows: await k.store(query).partnerReport(id, {}, k.now()) };
  }

  /** The partner view, per coupon, in a period. Admin only; every read is audited (so it takes the transaction). */
  async function partnerReport(tx: Query, actor: Actor, id: string, period: { from?: Date; to?: Date } = {}): Promise<PartnerRow[]> {
    await must(k.store(tx).partnerById(id), COUPON_ERROR.partnerNotFound, `No partner ${id}`);
    await k.record(tx, actor, "partner.report_read", { type: "partner", id }, {});
    return k.store(tx).partnerReport(id, period, k.now());
  }

  return {
    generateCode: generateFreeCode,
    create,
    update,
    pause: (tx: Query, actor: Actor, id: string) => setStatus(tx, actor, id, COUPON_STATUS.paused, "coupon.paused"),
    resume: (tx: Query, actor: Actor, id: string) => setStatus(tx, actor, id, COUPON_STATUS.active, "coupon.resumed"),
    archive: (tx: Query, actor: Actor, id: string) => setStatus(tx, actor, id, COUPON_STATUS.archived, "coupon.archived"),
    get: (query: Query, id: string) => k.store(query).couponById(id),
    list: (query: Query, filter: Partial<CouponFilter> = {}) => k.store(query).listCoupons({ ...filter, ...page(filter.limit, filter.offset) }),
    redemptions: (query: Query, filter: Partial<RedemptionFilter> = {}): Promise<Redemption[]> => k.store(query).listRedemptions({ ...filter, ...page(filter.limit, filter.offset) }),
    checkPrices,
    partners: {
      create: createPartner,
      archive: (tx: Query, actor: Actor, id: string) => setPartnerStatus(tx, actor, id, "archived"),
      restore: (tx: Query, actor: Actor, id: string) => setPartnerStatus(tx, actor, id, "active"),
      erase: erasePartner,
      get: (query: Query, id: string) => k.store(query).partnerById(id),
      list: (query: Query, options: { includeArchived?: boolean; limit?: number; offset?: number } = {}) => k.store(query).listPartners({ includeArchived: options.includeArchived ?? false, ...page(options.limit, options.offset) }),
      export: exportPartner,
      report: partnerReport,
    },
  };
}

export type CouponAdmin = ReturnType<typeof makeAdmin>;
