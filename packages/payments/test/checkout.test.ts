import { describe, expect, it } from "vitest";

import { assertTerms, type CheckoutRequest, type DiscountTerms, memoryDiscountStore, PAYMENTS_CODE, PaymentsError, processorAdapter } from "../src/index";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const clock = { now: () => NOW };
const plans = { pro: { lookupKey: "k_pro", mode: "subscription" as const }, audit: { lookupKey: "k_audit", mode: "payment" as const } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const request = (over: Partial<CheckoutRequest> = {}): CheckoutRequest => ({ kind: "pro", customerId: "cus_1", accountId: "a1", successUrl: "https://s", cancelUrl: "https://c", locale: "en", ...over });
const pct: DiscountTerms = { couponId: "cpn_1", termsVersion: 1, percentOffBp: 2000, duration: "repeating", durationMonths: 3 };

/** A fake processor recording every call; the lookups answer a price, coupons and sessions answer their ids. */
function fake() {
  const calls: { url: string; method: string; headers: Record<string, string>; form: URLSearchParams }[] = [];
  let coupons = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: String(init?.method), headers: (init?.headers ?? {}) as Record<string, string>, form: new URLSearchParams(String(init?.body ?? "")) });
    if (url.includes("/v1/prices")) return json({ data: [{ id: "price_1" }] });
    if (url.includes("/v1/coupons")) return json({ id: `co_${++coupons}` });
    return json({ id: "cs_1", url: "https://checkout.example/pay", expires_at: 1_793_000_000 });
  }) as unknown as typeof fetch;
  const session = () => calls.find((c) => c.url.endsWith("/v1/checkout/sessions"))!;
  return { calls, fetchImpl, session, coupons: () => calls.filter((c) => c.url.includes("/v1/coupons")) };
}
const adapterOver = (f: ReturnType<typeof fake>, extra: object = {}) => processorAdapter({ secretKey: "test-key", webhookSecret: "whsec-test", plans, fetch: f.fetchImpl, clock, discounts: memoryDiscountStore(), ...extra });

describe("a discount on checkout", () => {
  it("sends the processor's coupon with automatic tax, never a promotion code", async () => {
    const f = fake();
    await adapterOver(f).checkout(request({ discount: pct }));
    const form = f.session().form;
    expect(form.get("discounts[0][coupon]")).toBe("co_1");
    expect(form.get("automatic_tax[enabled]")).toBe("true");
    expect(form.has("discounts[0][promotion_code]")).toBe(false);
    expect(form.has("allow_promotion_codes")).toBe(false);
  });
  it("makes the coupon from the terms: basis points to a percentage, months, the coupon id in metadata, a stable idempotency key", async () => {
    const f = fake();
    await adapterOver(f).checkout(request({ discount: { ...pct, percentOffBp: 1250 } }));
    const [coupon] = f.coupons();
    expect(coupon!.form.get("percent_off")).toBe("12.5");
    expect(coupon!.form.get("duration")).toBe("repeating");
    expect(coupon!.form.get("duration_in_months")).toBe("3");
    expect(coupon!.form.get("metadata[coupon_id]")).toBe("cpn_1");
    expect(coupon!.form.get("metadata[terms_version]")).toBe("1");
    expect(coupon!.headers["idempotency-key"]).toBe("coupon-cpn_1-v1");
  });
  it("makes an amount-off coupon with its currency", async () => {
    const f = fake();
    await adapterOver(f).checkout(request({ discount: { couponId: "cpn_2", termsVersion: 2, amountOffMinor: 500, currency: "cad", duration: "once" } }));
    const [coupon] = f.coupons();
    expect(coupon!.form.get("amount_off")).toBe("500");
    expect(coupon!.form.get("currency")).toBe("cad");
    expect(coupon!.form.has("percent_off")).toBe(false);
    expect(coupon!.form.has("duration_in_months")).toBe(false);
  });
  it("makes one coupon per (coupon, terms version): the second checkout reuses it, a new version makes a new one", async () => {
    const f = fake();
    const adapter = adapterOver(f);
    await adapter.checkout(request({ discount: pct }));
    await adapter.checkout(request({ discount: pct }));
    expect(f.coupons()).toHaveLength(1);
    await adapter.checkout(request({ discount: { ...pct, termsVersion: 2 } }));
    expect(f.coupons()).toHaveLength(2);
  });
  it("sends no discount and makes no coupon without terms", async () => {
    const f = fake();
    await adapterOver(f).checkout(request());
    expect(f.coupons()).toHaveLength(0);
    expect(f.session().form.has("discounts[0][coupon]")).toBe(false);
  });
  it("needs the discounts store", async () => {
    const f = fake();
    await expect(processorAdapter({ secretKey: "k", webhookSecret: "w", plans, fetch: f.fetchImpl }).checkout(request({ discount: pct }))).rejects.toMatchObject({ code: PAYMENTS_CODE.badDiscount, status: 500 });
  });
  it("refuses bad terms before any call", () => {
    const bad = (terms: Partial<DiscountTerms>, mode: "payment" | "subscription" = "subscription") => () => assertTerms({ ...pct, ...terms }, mode);
    expect(bad({ percentOffBp: undefined })).toThrow(/percentage or an amount/);
    expect(bad({ amountOffMinor: 100, currency: "cad" })).toThrow(/never both/);
    expect(bad({ percentOffBp: 0 })).toThrow(/basis points/);
    expect(bad({ percentOffBp: 10_001 })).toThrow(/basis points/);
    expect(bad({ percentOffBp: 12.5 })).toThrow(/basis points/);
    expect(bad({ percentOffBp: undefined, amountOffMinor: 0, currency: "cad" })).toThrow(/amount off/);
    expect(bad({ percentOffBp: undefined, amountOffMinor: 1.5, currency: "cad" })).toThrow(/amount off/);
    expect(bad({ percentOffBp: undefined, amountOffMinor: 100 })).toThrow(/amount off/);
    expect(bad({ percentOffBp: undefined, amountOffMinor: 100, currency: "CAD" })).toThrow(/amount off/);
    expect(bad({ termsVersion: 0 })).toThrow(/version/);
    expect(bad({ durationMonths: undefined })).toThrow(/months/);
    expect(bad({ durationMonths: 0 })).toThrow(/months/);
    expect(bad({ duration: "repeating" }, "payment")).toThrow(/once/);
    expect(bad({ duration: "forever" }, "payment")).toThrow(/once/);
    expect(bad({ duration: "once" }, "payment")).not.toThrow();
    expect(bad({ percentOffBp: 10_000, duration: "forever" })).not.toThrow();
  });
  it("refuses a repeating discount on a one-off plan, with a typed code", async () => {
    const f = fake();
    await expect(adapterOver(f).checkout(request({ kind: "audit", discount: pct }))).rejects.toMatchObject({ code: PAYMENTS_CODE.badDiscount, status: 422 });
    expect(f.calls).toHaveLength(0);
  });
});

describe("the session's identity and lifetime", () => {
  it("passes the idempotency key, so a retry returns the same session", async () => {
    const f = fake();
    await adapterOver(f).checkout(request({ idempotencyKey: "redemption-7" }));
    expect(f.session().headers["idempotency-key"]).toBe("redemption-7");
  });
  it("sends no idempotency key when none is given", async () => {
    const f = fake();
    await adapterOver(f).checkout(request());
    expect(f.session().headers["idempotency-key"]).toBeUndefined();
  });
  it("echoes the metadata, the adapter's own keys winning, and answers the session reference and expiry", async () => {
    const f = fake();
    const out = await adapterOver(f).checkout(request({ metadata: { redemption_id: "r7", account_id: "spoofed", kind: "spoofed" } }));
    const form = f.session().form;
    expect(form.get("metadata[redemption_id]")).toBe("r7");
    expect(form.get("metadata[account_id]")).toBe("a1");
    expect(form.get("metadata[kind]")).toBe("pro");
    expect(out).toEqual({ url: "https://checkout.example/pay", checkoutRef: "cs_1", expiresAt: new Date(1_793_000_000 * 1000) });
  });
  it("answers no expiry when the processor sends none", async () => {
    const fetchImpl = (async (url: string) => (url.includes("/v1/prices") ? json({ data: [{ id: "p" }] }) : json({ id: "cs_2", url: "u" }))) as unknown as typeof fetch;
    expect((await processorAdapter({ secretKey: "k", webhookSecret: "w", plans, fetch: fetchImpl }).checkout(request())).expiresAt).toBeNull();
  });
  it("asks for expires_at in epoch seconds inside the 30 minutes to 24 hours window", async () => {
    const f = fake();
    const at = new Date(NOW.valueOf() + 45 * 60 * 1000);
    await adapterOver(f).checkout(request({ expiresAt: at }));
    expect(f.session().form.get("expires_at")).toBe(String(Math.floor(at.valueOf() / 1000)));
    const f2 = fake();
    await adapterOver(f2).checkout(request({ expiresAt: new Date(NOW.valueOf() + 24 * 3600 * 1000) }));
    expect(f2.session().form.has("expires_at")).toBe(true);
  });
  it("refuses an expiry that is too soon or too far, before any call", async () => {
    const f = fake();
    const adapter = adapterOver(f);
    await expect(adapter.checkout(request({ expiresAt: new Date(NOW.valueOf() + 30 * 60 * 1000) }))).rejects.toMatchObject({ code: PAYMENTS_CODE.badExpiry, status: 422 });
    await expect(adapter.checkout(request({ expiresAt: new Date(NOW.valueOf() + 24 * 3600 * 1000 + 1000) }))).rejects.toMatchObject({ code: PAYMENTS_CODE.badExpiry });
    expect(f.calls).toHaveLength(0);
  });
  it("needs the clock to check an expiry", async () => {
    const f = fake();
    const noClock = processorAdapter({ secretKey: "k", webhookSecret: "w", plans, fetch: f.fetchImpl });
    await expect(noClock.checkout(request({ expiresAt: new Date(NOW.valueOf() + 3600_000) }))).rejects.toMatchObject({ code: PAYMENTS_CODE.needsClock });
  });
});

describe("the webhook tolerance is a setting", () => {
  it("a narrower tolerance refuses a delayed notification the default would accept", async () => {
    const { signPayload } = await import("../src/index");
    const body = JSON.stringify({ id: "evt_1", type: "x", data: { object: {} } });
    const headers = new Headers({ "stripe-signature": signPayload(body, "whsec-test", 1_000) });
    const f = fake();
    expect(adapterOver(f).parseWebhook(body, headers, 1_100)).toEqual({ id: "evt_1", type: "ignored" });
    expect(() => adapterOver(f, { webhookToleranceSeconds: 30 }).parseWebhook(body, headers, 1_100)).toThrow(PaymentsError);
  });
});
