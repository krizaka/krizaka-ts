import { describe, expect, it } from "vitest";

import { formEncode, PaymentsError, signPayload, stripeAdapter, translate, verifySignature } from "../src/index";

const SIGNING = "signing-material-for-unit-tests";
const NOW = 1_800_000_000;
const plans = { founder: { lookupKey: "k_founder", mode: "subscription" as const }, audit: { lookupKey: "k_audit", mode: "payment" as const } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const adapter = (fetchImpl: typeof fetch, extra: object = {}) => stripeAdapter({ secretKey: "test-api-key", webhookSecret: SIGNING, plans, fetch: fetchImpl, ...extra });

describe("the webhook signature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "x", data: { object: {} } });
  it("accepts a good signature inside the window", () => {
    expect(() => verifySignature(body, signPayload(body, SIGNING, NOW), SIGNING, NOW + 10)).not.toThrow();
  });
  it("accepts one of several v1 signatures (secret rotation)", () => {
    const good = signPayload(body, SIGNING, NOW);
    expect(() => verifySignature(body, `${good.replace("v1=", "v1=00,v1=")}`, SIGNING, NOW)).not.toThrow();
  });
  it("refuses a wrong secret, an altered body, a missing or malformed header, a replay", () => {
    expect(() => verifySignature(body, signPayload(body, "other", NOW), SIGNING, NOW)).toThrow(PaymentsError);
    expect(() => verifySignature(`${body} `, signPayload(body, SIGNING, NOW), SIGNING, NOW)).toThrow(PaymentsError);
    expect(() => verifySignature(body, null, SIGNING, NOW)).toThrow(PaymentsError);
    expect(() => verifySignature(body, "garbage", SIGNING, NOW)).toThrow(PaymentsError);
    expect(() => verifySignature(body, signPayload(body, SIGNING, NOW), SIGNING, NOW + 3600)).toThrow(PaymentsError);
  });
  it("a PaymentsError carries its status", () => {
    try {
      verifySignature(body, null, SIGNING, NOW);
    } catch (e) {
      expect((e as PaymentsError).status).toBe(400);
      expect((e as PaymentsError).name).toBe("PaymentsError");
    }
  });
});

describe("the processor's events, in the domain's words", () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_9", type, data: { object } });
  it("a paid one-off checkout carries its plan", () => {
    expect(translate(ev("checkout.session.completed", { mode: "payment", payment_status: "paid", customer: "cus_1", metadata: { account_id: "a1", kind: "audit" } }))).toMatchObject({ id: "evt_9", type: "payment_paid", kind: "audit", accountId: "a1", customerId: "cus_1" });
  });
  it("the account may come from client_reference_id", () => {
    expect(translate(ev("checkout.session.completed", { mode: "subscription", client_reference_id: "a2", subscription: "sub_1" }))).toMatchObject({ type: "subscription_started", accountId: "a2", customerId: null, subscriptionId: "sub_1" });
  });
  it("a subscription started without a subscription id", () => {
    expect(translate(ev("checkout.session.completed", { mode: "subscription", customer: "cus_1", metadata: { account_id: "a1" } }))).toMatchObject({ subscriptionId: null });
  });
  it("a subscription's life", () => {
    expect(translate(ev("customer.subscription.updated", { id: "sub_1", status: "active", customer: "cus_1", items: { data: [{ current_period_end: 1_900_000_000 }] } }))).toMatchObject({ type: "subscription_changed", active: true, periodEnd: 1_900_000_000 });
    expect(translate(ev("customer.subscription.updated", { id: "sub_1", status: "trialing", metadata: { account_id: "a1" }, current_period_end: 1_900_000_001 }))).toMatchObject({ active: true, accountId: "a1", periodEnd: 1_900_000_001, customerId: null });
    expect(translate(ev("customer.subscription.deleted", { id: "sub_1", status: "active", customer: "cus_1" }))).toMatchObject({ status: "canceled", active: false, periodEnd: null });
    expect(translate(ev("customer.subscription.created", { id: "sub_1", status: "past_due", customer: "cus_1" }))).toMatchObject({ active: false });
    expect(translate(ev("customer.subscription.created", {}))).toMatchObject({ status: "", subscriptionId: "" });
  });
  it("an unpaid, anonymous, unknown-mode or foreign event is ignored", () => {
    expect(translate(ev("checkout.session.completed", { mode: "payment", payment_status: "unpaid", metadata: { account_id: "a1", kind: "audit" } })).type).toBe("ignored");
    expect(translate(ev("checkout.session.completed", { mode: "payment", payment_status: "paid", metadata: { account_id: "a1" } })).type).toBe("ignored");
    expect(translate(ev("checkout.session.completed", { mode: "subscription", metadata: {} })).type).toBe("ignored");
    expect(translate(ev("checkout.session.completed", { mode: "setup", metadata: { account_id: "a1" } })).type).toBe("ignored");
    expect(translate(ev("charge.refunded", {})).type).toBe("ignored");
  });
});

describe("the adapter's calls", () => {
  it("reads the price by lookup key and opens a subscription Checkout with automatic tax", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.includes("/v1/prices") ? json({ data: [{ id: "price_f" }] }) : json({ url: "https://checkout.example/pay" });
    }) as unknown as typeof fetch;
    const out = await adapter(fake).checkout({ kind: "founder", customerId: "cus_1", accountId: "a1", successUrl: "https://s", cancelUrl: "https://c", locale: "fr" });
    expect(out.url).toBe("https://checkout.example/pay");
    expect(calls[0]!.url).toContain("lookup_keys%5B0%5D=k_founder");
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer test-api-key");
    const form = new URLSearchParams(String(calls[1]!.init?.body));
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("line_items[0][price]")).toBe("price_f");
    expect(form.get("automatic_tax[enabled]")).toBe("true");
    expect(form.get("tax_id_collection[enabled]")).toBe("true");
    expect(form.get("subscription_data[metadata][account_id]")).toBe("a1");
    expect(form.get("invoice_creation[enabled]")).toBeNull();
    expect(form.get("metadata[kind]")).toBe("founder");
    expect(form.get("locale")).toBe("fr");
  });
  it("a one-off plan is a payment with an invoice", async () => {
    const bodies: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return url.includes("/v1/prices") ? json({ data: [{ id: "price_a" }] }) : json({ url: "https://checkout.example/a" });
    }) as unknown as typeof fetch;
    await adapter(fake).checkout({ kind: "audit", customerId: "c", accountId: "a1", successUrl: "s", cancelUrl: "c", locale: "en" });
    const form = new URLSearchParams(bodies[1]);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("invoice_creation[enabled]")).toBe("true");
    expect(form.get("subscription_data[metadata][account_id]")).toBeNull();
  });
  it("a missing price or an unknown plan is an error, not a guess", async () => {
    const empty = (async () => json({ data: [] })) as unknown as typeof fetch;
    await expect(adapter(empty).price("founder")).rejects.toThrow(/lookup key k_founder/);
    await expect(adapter(empty).price("nope")).rejects.toThrow(/Unknown plan/);
  });
  it("reads the price: amount, currency, interval", async () => {
    const fake = (async () => json({ data: [{ id: "price_f", unit_amount: 3900, currency: "cad", recurring: { interval: "month" } }] })) as unknown as typeof fetch;
    expect(await adapter(fake).price("founder")).toEqual({ amount: 3900, currency: "cad", interval: "month" });
    const once = (async () => json({ data: [{ id: "p", unit_amount: 999, currency: "cad", recurring: null }] })) as unknown as typeof fetch;
    expect(await adapter(once).price("audit")).toEqual({ amount: 999, currency: "cad", interval: null });
    const noAmount = (async () => json({ data: [{ id: "p" }] })) as unknown as typeof fetch;
    expect(await adapter(noAmount).price("audit")).toEqual({ amount: 0, currency: "usd", interval: null });
  });
  it("creates the customer once per account (idempotency key) and opens the portal", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return json({ id: "cus_1", url: "https://portal.example" });
    }) as unknown as typeof fetch;
    const a = adapter(fake, { apiBase: "https://stripe.test/" });
    expect(await a.createCustomer("e@x.test", "a1")).toEqual({ id: "cus_1", url: "https://portal.example" });
    expect((seen[0]!.init?.headers as Record<string, string>)["idempotency-key"]).toBe("customer-a1");
    expect(seen[0]!.url).toBe("https://stripe.test/v1/customers");
    expect(await a.portal("cus_1", "https://r", "en")).toMatchObject({ url: "https://portal.example" });
    expect(new URLSearchParams(String(seen[1]!.init?.body)).get("return_url")).toBe("https://r");
  });
  it("a processor error becomes a PaymentsError with its message, or a generic one", async () => {
    const bad = (async () => json({ error: { message: "No such customer" } }, 404)) as unknown as typeof fetch;
    await expect(adapter(bad).portal("c", "r", "en")).rejects.toMatchObject({ status: 404, message: "No such customer" });
    const opaque = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await expect(adapter(opaque).portal("c", "r", "en")).rejects.toMatchObject({ status: 500, message: "Stripe answered 500" });
  });
  it("parses a signed webhook and refuses an unsigned one", () => {
    const a = adapter((async () => json({})) as unknown as typeof fetch);
    const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } });
    const headers = new Headers({ "stripe-signature": signPayload(body, SIGNING, NOW) });
    expect(a.parseWebhook(body, headers, NOW)).toMatchObject({ type: "subscription_changed", status: "canceled" });
    expect(() => a.parseWebhook(body, new Headers(), NOW)).toThrow(PaymentsError);
  });
  it("uses the global fetch by default", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => json({ data: [{ id: "p", unit_amount: 1, currency: "cad" }] })) as unknown as typeof fetch;
    try {
      expect(await stripeAdapter({ secretKey: "k", webhookSecret: "w", plans }).price("audit")).toMatchObject({ amount: 1 });
    } finally {
      globalThis.fetch = original;
    }
  });
  it("encodes nested forms the way the processor reads them", () => {
    expect(formEncode({ a: { b: [1, { c: 2 }] }, d: true, e: undefined, f: null }).toString()).toBe("a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B1%5D%5Bc%5D=2&d=true");
  });
});
