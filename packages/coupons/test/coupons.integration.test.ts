import { randomUUID } from "node:crypto";

import { createAudit } from "@krizaka/audit";
import { auditSchema } from "@krizaka/audit";
import { createCredits, CREDITS_DEFAULTS, creditsSchema } from "@krizaka/credits";
import { emitMigration, transaction } from "@krizaka/db";
import { createOutbox, OUTBOX_DEFAULTS, outboxSchema } from "@krizaka/outbox";
import {
  applyOnceInTransaction,
  memoryDiscountStore,
  paymentsSchema,
  processorAdapter,
  signPayload,
} from "@krizaka/payments";
import { createLimiter, memoryLimitStore } from "@krizaka/rate-limit";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COUPON_ATTEMPT_ACTION,
  COUPON_DEFAULTS,
  type CouponSettings,
  couponsSchema,
  createCoupons,
  type Query,
} from "../src";
import { couponAttemptLimit } from "../src/settings";
import { couponsContract, type CouponsHarness, credit, discount, T0 } from "../src/testkit";

/** The module against a real PostgreSQL (CI's service; locally ORGANIZE_DB_IT=1 and a DATABASE_URL), in schemas of its own. */
const enabled = process.env.ORGANIZE_DB_IT === "1" && !!process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);
const schemas = {
  coupons: `cp_${suffix}`,
  credits: `cc_${suffix}`,
  payments: `cy_${suffix}`,
  audit: `ca_${suffix}`,
  outbox: `co_${suffix}`,
};
const accounts = `cp_${suffix}_account`;
const ADMIN = { id: null, label: "Eric (admin)" };
const HOUR = 3600;
const at = (seconds: number) => new Date(T0.valueOf() + seconds * 1000);

describe.runIf(enabled)("coupons: PostgreSQL", () => {
  let pool: pg.Pool;
  const query: Query = async <T>(sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows as T[];
  const connect = async () => pool.connect();
  const inTx = <T>(work: (tx: Query) => Promise<T>) => transaction(connect, work);
  let now = T0;
  let settings: CouponSettings = { ...COUPON_DEFAULTS, enabled: true };
  const creditCalls: CouponsHarness["credits"] = { granted: [], expired: [] };
  const announced: ReturnType<CouponsHarness["announced"]> = [];
  const audited: ReturnType<CouponsHarness["audited"]> = [];
  const attempts: CouponsHarness["limiter"]["attempts"] = [];
  let refused: number | null = null;
  const seen = new Set<string>();

  const credits = () =>
    createCredits({ clock: { now: () => now }, settings: CREDITS_DEFAULTS, schema: schemas.credits });
  const newAccount = async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO ${accounts} (id) VALUES ($1)`, [id]);
    return id;
  };
  const wrapped = () => {
    const real = credits();
    return {
      async grant(tx: Query, input: Parameters<typeof real.grant>[1]) {
        creditCalls.granted.push(input);
        return real.grant(tx, input);
      },
      async expire(tx: Query, grantId: string) {
        creditCalls.expired.push(grantId);
        return real.expire(tx, grantId);
      },
    };
  };
  const coupons = () =>
    createCoupons({
      clock: { now: () => now },
      settings: () => settings,
      schema: schemas.coupons,
      credits: wrapped(),
      audit: { record: async (_tx, e) => void audited.push({ action: e.action, target: e.target, detail: e.detail }) },
      rateLimit: {
        async check(action, keys) {
          attempts.push({ action, ip: keys.ip, subject: keys.subject });
          return refused === null ? { ok: true } : { ok: false, retryAfterSeconds: refused };
        },
      },
      outbox: {
        async append(_tx, m) {
          const id = m.id ?? randomUUID();
          const appended = !seen.has(id);
          seen.add(id);
          if (appended) announced.push({ type: m.type, id, payload: m.payload as Record<string, unknown> });
          return { id, appended };
        },
      },
    });
  const reset = async () => {
    await pool.query(
      `TRUNCATE ${schemas.coupons}.redemption, ${schemas.coupons}.coupon, ${schemas.coupons}.partner CASCADE`,
    );
    await pool.query(`TRUNCATE ${schemas.credits}.entry, ${schemas.credits}.hold, ${schemas.credits}."grant"`);
    now = T0;
    settings = { ...COUPON_DEFAULTS, enabled: true };
    creditCalls.granted.length = 0;
    creditCalls.expired.length = 0;
    announced.length = 0;
    audited.length = 0;
    attempts.length = 0;
    refused = null;
    seen.clear();
  };
  const apply = (c: ReturnType<typeof coupons>, code: string, accountId: string, key: string = randomUUID()) =>
    inTx((tx) =>
      c.apply(tx, { code, accountId, plan: "pro", amountMinor: 10_000, currency: "cad", idempotencyKey: key }),
    );

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 40 });
    await pool.query(`CREATE TABLE ${accounts} (id uuid PRIMARY KEY)`);
    const owner = { owner: accounts };
    await pool.query(emitMigration(couponsSchema, 1, { tables: owner, schema: schemas.coupons }));
    await pool.query(emitMigration(creditsSchema, 1, { tables: owner, schema: schemas.credits }));
    await pool.query(emitMigration(paymentsSchema, 1, { tables: {}, schema: schemas.payments }));
    await pool.query(emitMigration(auditSchema, 1, { tables: owner, schema: schemas.audit }));
    await pool.query(emitMigration(outboxSchema, 1, { tables: {}, schema: schemas.outbox }));
  });
  afterAll(async () => {
    for (const s of Object.values(schemas)) await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await pool.query(`DROP TABLE ${accounts}`);
    await pool.end();
  });

  couponsContract("pg", async () => {
    await reset();
    return {
      coupons: coupons(),
      tx: query,
      setNow: (d) => void (now = d),
      setSettings: (patch) => void (settings = { ...settings, ...patch }),
      newAccount,
      announced: () => announced,
      audited: () => audited,
      credits: creditCalls,
      limiter: { attempts, refuse: (retry) => void (refused = retry) },
    };
  });

  it("THE LAST USE: two requests for the last use of a code, in their own transactions, give it to one (run in a loop)", async () => {
    for (let round = 0; round < 50; round += 1) {
      await reset();
      const c = coupons();
      const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad", maxRedemptions: 1 })));
      const [x, y] = [await newAccount(), await newAccount()];
      const results = await Promise.allSettled([apply(c, coupon.code, x), apply(c, coupon.code, y)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: "COUPON_EXHAUSTED" });
    }
  });

  it("MANY CONTENDERS: twenty requests for a code with three uses give exactly three", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const c = coupons();
      const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad", maxRedemptions: 3 })));
      const accountIds = await Promise.all(Array.from({ length: 20 }, () => newAccount()));
      const results = await Promise.allSettled(accountIds.map((a) => apply(c, coupon.code, a)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(
        (await inTx((tx) => c.admin.redemptions(tx, { couponId: coupon.id }))).filter((r) => r.status === "reserved"),
      ).toHaveLength(3);
    }
  });

  it("ONE ACCOUNT, MANY TABS: the same account asking at once with different keys gets one use", async () => {
    await reset();
    const c = coupons();
    const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad" })));
    const a = await newAccount();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => apply(c, coupon.code, a)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("ONE KEY, MANY REQUESTS: the same key sent at once is one reservation", async () => {
    await reset();
    const c = coupons();
    const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad" })));
    const a = await newAccount();
    const results = await Promise.all(Array.from({ length: 10 }, () => apply(c, coupon.code, a, "same-key")));
    expect(new Set(results.map((r) => r.redemptionId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
  });

  it("THE PAYMENT EVENT, REPLAYED AT ONCE: confirms once, whatever the number of deliveries", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const c = coupons();
      const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad", maxRedemptions: 5 })));
      const a = await newAccount();
      const r = await apply(c, coupon.code, a);
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () =>
          inTx((tx) =>
            c.redeem(tx, {
              redemptionId: r.redemptionId,
              paymentRef: `pi_${round}`,
              amountPaidMinor: 8000,
              amountDiscountMinor: 2000,
              currency: "cad",
            }),
          ),
        ),
      );
      expect(outcomes.filter((o) => o === "confirmed")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "already")).toHaveLength(9);
      expect(announced.filter((m) => m.type === "evt.coupon.redeemed.v1")).toHaveLength(1);
    }
  });

  it("TWO SWEEPERS: each reservation past its deadline is released once, whoever sweeps it", async () => {
    await reset();
    const c = coupons();
    const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad" })));
    await Promise.all(Array.from({ length: 12 }, async () => apply(c, coupon.code, await newAccount())));
    now = at(HOUR);
    const swept = await Promise.all([
      inTx((tx) => c.releaseExpired(tx)),
      inTx((tx) => c.releaseExpired(tx)),
      inTx((tx) => c.releaseExpired(tx)),
    ]);
    expect(swept.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("a deleted account leaves its redemption: the use still counts overall", async () => {
    await reset();
    const c = coupons();
    const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad", maxRedemptions: 1 })));
    const a = await newAccount();
    const r = await apply(c, coupon.code, a);
    await inTx((tx) =>
      c.redeem(tx, {
        redemptionId: r.redemptionId,
        paymentRef: "pi_del",
        amountPaidMinor: 8000,
        amountDiscountMinor: 2000,
        currency: "cad",
      }),
    );
    await pool.query(`DELETE FROM ${accounts} WHERE id = $1`, [a]);
    const [row] = await inTx((tx) => c.admin.redemptions(tx, { couponId: coupon.id }));
    expect(row).toMatchObject({ accountId: null, status: "confirmed" });
    expect(
      await c.validate(query, coupon.code, {
        mode: "checkout",
        accountId: await newAccount(),
        plan: "pro",
        amountMinor: 10_000,
        currency: "cad",
      }),
    ).toEqual({ ok: false, code: "COUPON_EXHAUSTED" });
  });

  it("the database refuses what the rules refuse: a free discount, a nameless live partner, a credit coupon with no credits, a fixed amount forever", async () => {
    await reset();
    const t = `${schemas.coupons}.coupon`;
    const insert = (cols: string, vals: string) =>
      pool.query(
        `INSERT INTO ${t} (id, code, code_key, kind, purpose, starts_at, created_at, updated_at, ${cols}) VALUES ($1, 'ABCDEFGH', $2, ${vals.split("|")[0]}, 'promo', now(), now(), now(), ${vals.split("|")[1]})`,
        [randomUUID(), randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()],
      );
    await expect(insert("percent_off_bp, duration", "'discount'|10000, 'once'")).rejects.toThrow();
    await expect(insert("amount_off_minor, currency, duration", "'discount'|500, 'cad', 'forever'")).rejects.toThrow();
    await expect(insert("on_exhausted", "'credit'|'stop'")).rejects.toThrow();
    await expect(insert("percent_off_bp, duration", "'discount'|1000, 'once'")).resolves.toBeDefined();
    await expect(
      pool.query(`INSERT INTO ${schemas.coupons}.partner (id, status, created_at) VALUES ($1, 'active', now())`, [
        randomUUID(),
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `INSERT INTO ${schemas.coupons}.partner (id, display_name, contact_email, status, created_at, erased_at) VALUES ($1, 'Marie', NULL, 'archived', now(), now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it("a partner coupon, a payment, a refund: the whole path with the payments package, in Stripe's test shapes and no network", async () => {
    await reset();
    const c = coupons();
    const partner = await inTx((tx) =>
      c.admin.partners.create(tx, ADMIN, { displayName: "Marie Tremblay", contactEmail: "marie@example.com" }),
    );
    const coupon = await inTx((tx) =>
      c.admin.create(
        tx,
        ADMIN,
        discount({ currency: "cad", purpose: "partner", partnerId: partner.id, plans: ["pro"] }),
      ),
    );
    const account = await newAccount();
    const typed = ` ${coupon.code.toLowerCase()} `;

    // 1. the person types the code; 2. the product reserves a use; 3. the session is created outside any transaction
    expect(
      (
        await c.validate(query, typed, {
          mode: "checkout",
          accountId: account,
          plan: "pro",
          amountMinor: 3900,
          currency: "cad",
        })
      ).ok,
    ).toBe(true);
    const applied = await inTx((tx) =>
      c.apply(tx, {
        code: typed,
        accountId: account,
        plan: "pro",
        amountMinor: 3900,
        currency: "cad",
        idempotencyKey: "co-1",
      }),
    );
    const bodies: URLSearchParams[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      bodies.push(new URLSearchParams(String(init?.body ?? "")));
      if (url.includes("/v1/prices")) return new Response(JSON.stringify({ data: [{ id: "price_pro" }] }));
      if (url.includes("/v1/coupons")) return new Response(JSON.stringify({ id: "co_stripe_1" }));
      return new Response(
        JSON.stringify({
          id: "cs_test_1",
          url: "https://checkout.example/pay",
          expires_at: Math.floor(at(2 * HOUR).valueOf() / 1000),
        }),
      );
    }) as unknown as typeof fetch;
    const adapter = processorAdapter({
      secretKey: "test-key",
      webhookSecret: "whsec-test",
      plans: { pro: { lookupKey: "yomizaka.pro", mode: "subscription" } },
      fetch: fake,
      clock: { now: () => now },
      discounts: memoryDiscountStore(),
    });
    const session = await adapter.checkout({
      kind: "pro",
      customerId: "cus_1",
      accountId: account,
      successUrl: "https://s",
      cancelUrl: "https://c",
      locale: "fr",
      discount: applied.discount,
      idempotencyKey: applied.redemptionId,
      metadata: { redemption_id: applied.redemptionId },
      expiresAt: at(HOUR + 40 * 60),
    });
    const sessionBody = bodies.at(-1)!;
    expect(sessionBody.get("discounts[0][coupon]")).toBe("co_stripe_1");
    expect(sessionBody.get("automatic_tax[enabled]")).toBe("true");
    expect(sessionBody.get("metadata[redemption_id]")).toBe(applied.redemptionId);
    await inTx((tx) => c.attachCheckout(tx, applied.redemptionId, session.checkoutRef, session.expiresAt));

    // 4. the webhook: verified, translated, recorded and applied in ONE transaction
    const body = JSON.stringify({
      id: "evt_paid_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          mode: "subscription",
          payment_status: "paid",
          customer: "cus_1",
          subscription: "sub_1",
          invoice: "in_1",
          amount_total: 3500,
          currency: "cad",
          total_details: { amount_discount: 390 },
          metadata: { account_id: account, kind: "pro", redemption_id: applied.redemptionId },
        },
      },
    });
    const event = adapter.parseWebhook(
      body,
      new Headers({ "stripe-signature": signPayload(body, "whsec-test", Math.floor(now.valueOf() / 1000)) }),
      Math.floor(now.valueOf() / 1000),
    );
    expect(event.type).toBe("subscription_started");
    const handle = () =>
      applyOnceInTransaction(
        (work) => transaction(connect, work),
        event,
        {
          subscription_started: async (e, tx) => {
            await c.redeem(tx, {
              redemptionId: e.metadata.redemption_id,
              checkoutRef: e.checkoutRef,
              paymentRef: e.paymentRef ?? e.invoiceRef,
              amountPaidMinor: e.amountTotal,
              amountDiscountMinor: e.amountDiscount,
              currency: e.currency,
            });
          },
        },
        { table: { schema: schemas.payments, table: "event" } },
      );
    expect(await handle()).toBe("applied");
    expect(await handle()).toBe("duplicate");
    const [row] = await inTx((tx) => c.admin.redemptions(tx, { couponId: coupon.id }));
    expect(row).toMatchObject({
      status: "confirmed",
      paymentRef: "in_1",
      amountPaidMinor: 3500,
      amountDiscountMinor: 390,
      partnerId: partner.id,
      currency: "cad",
    });

    // 5. a partial refund by invoice: the use stays, the partner's revenue is net
    await inTx((tx) => c.refund(tx, { paymentRef: "pi_unknown", invoiceRef: "in_1", amountRefunded: 500 }));
    expect(await inTx((tx) => c.admin.partners.report(tx, ADMIN, partner.id))).toEqual([
      {
        couponId: coupon.id,
        code: coupon.code,
        currency: "cad",
        redemptions: 1,
        discountMinor: 390,
        revenueMinor: 3000,
        creditsGranted: 0,
      },
    ]);
    expect(announced.map((m) => m.type)).toEqual(
      expect.arrayContaining(["evt.coupon.redeemed.v1", "evt.coupon.refunded.v1"]),
    );
  });

  it("a credit coupon with the real ledger: the cap holds, the grant expires, a revoke writes off what is left", async () => {
    await reset();
    const c = coupons();
    const ledger = credits();
    const coupon = await inTx((tx) =>
      c.admin.create(tx, ADMIN, credit({ credits: 4, capPerDay: 2, creditsValidDays: 7 })),
    );
    const a = await newAccount();
    const got = await inTx((tx) => c.redeemCredit(tx, { code: coupon.code, accountId: a, idempotencyKey: "demo-1" }));
    expect(await ledger.balance(query, a)).toMatchObject({ total: 4, granted: 4 });
    await inTx((tx) => ledger.consume(tx, { accountId: a, amount: 2, reason: "audit:1", idempotencyKey: "u1" }));
    await expect(
      inTx((tx) => ledger.consume(tx, { accountId: a, amount: 1, reason: "audit:2", idempotencyKey: "u2" })),
    ).rejects.toMatchObject({ code: "CREDITS_CAP_DAY" });
    await inTx((tx) => c.revoke(tx, ADMIN, got.redemptionId));
    expect((await ledger.balance(query, a)).total).toBe(0);
    now = at(8 * 24 * HOUR);
    expect(await ledger.balance(query, a)).toMatchObject({ total: 0 });
  });

  it("the real audit trail, outbox and limiter plug in as they are (the types are the proof), and a refused attempt is counted before the lookup", async () => {
    await reset();
    const audit = createAudit({ clock: { now: () => now }, schema: schemas.audit });
    const outbox = createOutbox({ clock: { now: () => now }, settings: OUTBOX_DEFAULTS, schema: schemas.outbox });
    const limiter = createLimiter({
      store: memoryLimitStore(),
      clock: { now: () => now },
      limits: (action) =>
        action === COUPON_ATTEMPT_ACTION
          ? couponAttemptLimit({ ...COUPON_DEFAULTS, attemptsPerAccountPerHour: 2 })
          : undefined,
    });
    const c = createCoupons({
      clock: { now: () => now },
      settings: { ...COUPON_DEFAULTS, enabled: true },
      schema: schemas.coupons,
      audit,
      outbox,
      rateLimit: limiter,
      credits: credits(),
    });
    const coupon = await inTx((tx) => c.admin.create(tx, ADMIN, discount({ currency: "cad" })));
    const a = await newAccount();
    const ask = () =>
      c.validate(query, coupon.code, {
        mode: "checkout",
        accountId: a,
        plan: "pro",
        amountMinor: 1000,
        currency: "cad",
      });
    expect((await ask()).ok).toBe(true);
    expect((await ask()).ok).toBe(true);
    expect(await ask()).toMatchObject({ ok: false, code: "COUPON_RATE_LIMITED" });
    const r = await inTx((tx) => c.admin.update(tx, ADMIN, coupon.id, { maxRedemptions: 5 }));
    expect(r.maxRedemptions).toBe(5);
    const trail = await audit.list(query, { actionPrefix: "coupon." });
    expect(trail.map((e) => e.action).sort()).toEqual(["coupon.created", "coupon.updated"]);
    await inTx((tx) => outbox.append(tx, { topic: "coupons", type: "evt.coupon.redeemed.v1", payload: {} }));
  });
});

describe("coupons: the names it checks", () => {
  it("refuses an unsafe schema name before any SQL is written (a test that runs without a database)", async () => {
    const c = createCoupons({
      clock: { now: () => T0 },
      settings: { ...COUPON_DEFAULTS, enabled: true },
      schema: "coupons; DROP TABLE x",
      audit: { record: async () => {} },
      rateLimit: { check: async () => ({ ok: true }) },
    });
    await expect(
      c.validate((async () => []) as unknown as Query, "ABCDEFGH", { mode: "redeem", accountId: "a" }),
    ).rejects.toThrow(/DB_UNSAFE_IDENTIFIER/);
  });
});
