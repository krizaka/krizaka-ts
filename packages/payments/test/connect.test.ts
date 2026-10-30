import { describe, expect, it } from "vitest";

import {
  connectAdapter,
  handleConnectWebhook,
  memoryEventStore,
  PAYMENTS_CODE,
  PaymentsError,
  signPayload,
  translateConnect,
} from "../src/index";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Call = { path: string; method: string; headers: Record<string, string>; form: URLSearchParams };

/** A fake processor recording every call (no live call: Stripe's documented object shapes). */
function fake(answer: (path: string, method: string) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({
      path: u.pathname,
      method: String(init?.method),
      headers: (init?.headers ?? {}) as Record<string, string>,
      form: new URLSearchParams(String(init?.body ?? u.search.slice(1))),
    });
    return answer(u.pathname, String(init?.method)) ?? json({ id: "x_1" });
  }) as unknown as typeof fetch;
  return { calls, adapter: connectAdapter({ secretKey: "sk_test_x", fetch: fetchImpl }) };
}

describe("onboarding and status", () => {
  it("creates a Standard account and an account link with the app's URLs", async () => {
    const { calls, adapter } = fake((p) =>
      p === "/v1/accounts"
        ? json({ id: "acct_1" })
        : json({ url: "https://connect.stripe.com/setup/x", expires_at: 1_800_000_000 }),
    );
    expect(await adapter.createAccount({ key: "shop-1", email: "a@b.c", country: "ca" })).toEqual({
      accountId: "acct_1",
    });
    expect(calls[0]!.form.get("type")).toBe("standard");
    expect(calls[0]!.form.get("country")).toBe("CA");
    expect(calls[0]!.headers["idempotency-key"]).toBe("shop-1");
    const link = await adapter.onboardingLink({
      accountId: "acct_1",
      returnUrl: "https://app/return",
      refreshUrl: "https://app/refresh",
    });
    expect(link.url).toContain("connect.stripe.com");
    expect(link.expiresAt?.getTime()).toBe(1_800_000_000_000);
    expect(calls[1]!.form.get("return_url")).toBe("https://app/return");
    expect(calls[1]!.form.get("refresh_url")).toBe("https://app/refresh");
    expect(calls[1]!.form.get("type")).toBe("account_onboarding");
  });

  it.each([
    [{ charges_enabled: true, details_submitted: true, payouts_enabled: true }, "active"],
    [{ charges_enabled: false, details_submitted: true }, "restricted"],
    [{ charges_enabled: false, details_submitted: false }, "pending"],
  ])("reads the account status %j as %s", async (account, state) => {
    const { adapter } = fake(() => json({ id: "acct_1", ...account }));
    const s = await adapter.accountStatus("acct_1");
    expect(s.state).toBe(state);
    expect(s.chargesEnabled).toBe(account.charges_enabled);
  });
});

describe("saved card and payments, ON the connected account", () => {
  it("creates the customer and the SetupIntent with Stripe-Account, and returns only the client secret", async () => {
    const { calls, adapter } = fake((p) =>
      p === "/v1/setup_intents" ? json({ id: "seti_1", client_secret: "seti_1_secret" }) : json({ id: "cus_1" }),
    );
    expect(await adapter.createCustomer("acct_1", { key: "c1", email: "x@y.z" })).toEqual({ customerId: "cus_1" });
    expect(await adapter.saveCard("acct_1", { key: "s1", customerId: "cus_1" })).toEqual({
      setupRef: "seti_1",
      clientSecret: "seti_1_secret",
    });
    expect(calls.every((c) => c.headers["stripe-account"] === "acct_1")).toBe(true);
    expect(calls[1]!.form.get("usage")).toBe("off_session");
  });

  it("charges now (automatic capture) with no fee by default", async () => {
    const { calls, adapter } = fake(() =>
      json({ id: "pi_1", status: "succeeded", amount: 5000, amount_received: 5000, currency: "cad" }),
    );
    const p = await adapter.pay("acct_1", {
      key: "b-1",
      customerId: "cus_1",
      paymentMethodRef: "pm_1",
      amountMinor: 5000,
      currency: "CAD",
      mode: "capture",
    });
    expect(p).toEqual({ paymentRef: "pi_1", state: "paid", amountMinor: 5000, currency: "cad" });
    expect(calls[0]!.form.get("capture_method")).toBe("automatic");
    expect(calls[0]!.form.has("application_fee_amount")).toBe(false);
    expect(calls[0]!.headers["stripe-account"]).toBe("acct_1");
  });

  it("holds a deposit (manual capture), takes an application fee when given, captures part later", async () => {
    const { calls, adapter } = fake((p) =>
      p.endsWith("/capture")
        ? json({ id: "pi_1", status: "succeeded", amount: 2000, amount_received: 1500, currency: "cad" })
        : json({ id: "pi_1", status: "requires_capture", amount: 2000, currency: "cad" }),
    );
    const held = await adapter.pay("acct_1", {
      key: "d-1",
      customerId: "cus_1",
      paymentMethodRef: "pm_1",
      amountMinor: 2000,
      currency: "cad",
      mode: "hold",
      applicationFeeMinor: 100,
    });
    expect(held.state).toBe("held");
    expect(calls[0]!.form.get("capture_method")).toBe("manual");
    expect(calls[0]!.form.get("application_fee_amount")).toBe("100");
    const taken = await adapter.capture("acct_1", "pi_1", { key: "d-1:cap", amountMinor: 1500 });
    expect(taken).toMatchObject({ state: "paid", amountMinor: 1500 });
    expect(calls[1]!.form.get("amount_to_capture")).toBe("1500");
  });

  it("releases a held deposit", async () => {
    const { calls, adapter } = fake(() => json({ id: "pi_1", status: "canceled", amount: 2000, currency: "cad" }));
    expect((await adapter.release("acct_1", "pi_1", { key: "d-1:rel" })).state).toBe("released");
    expect(calls[0]!.path).toBe("/v1/payment_intents/pi_1/cancel");
  });

  it.each([-1, 0, 1.5])("refuses the amount %s", async (amountMinor) => {
    const { adapter } = fake();
    await expect(
      adapter.pay("acct_1", {
        key: "k",
        customerId: "c",
        paymentMethodRef: "p",
        amountMinor,
        currency: "cad",
        mode: "capture",
      }),
    ).rejects.toMatchObject({ code: PAYMENTS_CODE.badMoney });
  });

  it.each([-5, 1.5, 1000, 1001])("refuses the fee %s", async (applicationFeeMinor) => {
    const { adapter } = fake();
    await expect(
      adapter.pay("acct_1", {
        key: "k",
        customerId: "c",
        paymentMethodRef: "p",
        amountMinor: 1000,
        currency: "cad",
        mode: "capture",
        applicationFeeMinor,
      }),
    ).rejects.toMatchObject({ code: PAYMENTS_CODE.badFee });
  });

  it("maps a declined card to PAYMENTS_DECLINED (402)", async () => {
    const { adapter } = fake(() => json({ error: { type: "card_error", message: "Your card was declined." } }, 402));
    const error = await adapter
      .pay("acct_1", {
        key: "k",
        customerId: "c",
        paymentMethodRef: "p",
        amountMinor: 1000,
        currency: "cad",
        mode: "capture",
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(PaymentsError);
    expect(error).toMatchObject({ status: 402, code: PAYMENTS_CODE.declined });
  });
});

describe("refunds never exceed what was paid", () => {
  const withCharge = (captured: number, refunded: number) => (p: string) =>
    p === "/v1/refunds"
      ? json({ id: "re_1", amount: 700, currency: "cad" })
      : json({ id: "pi_1", latest_charge: { amount_captured: captured, amount_refunded: refunded } });

  it("refunds in full when no amount is given, and in part", async () => {
    const { calls, adapter } = fake(withCharge(1000, 0));
    await adapter.refund("acct_1", "pi_1", { key: "r1" });
    await adapter.refund("acct_1", "pi_1", { key: "r2", amountMinor: 700 });
    const posts = calls.filter((c) => c.path === "/v1/refunds");
    expect(posts[0]!.form.has("amount")).toBe(false);
    expect(posts[1]!.form.get("amount")).toBe("700");
    expect(posts[1]!.headers["stripe-account"]).toBe("acct_1");
  });

  it("refuses more than is left (paid minus already refunded) and calls no refund", async () => {
    const { calls, adapter } = fake(withCharge(1000, 400));
    await expect(adapter.refund("acct_1", "pi_1", { key: "r3", amountMinor: 700 })).rejects.toMatchObject({
      code: PAYMENTS_CODE.refundExceedsPaid,
    });
    expect(calls.some((c) => c.path === "/v1/refunds")).toBe(false);
  });

  it("refuses a payment that was never captured (a held deposit)", async () => {
    const { adapter } = fake(withCharge(0, 0));
    await expect(adapter.refund("acct_1", "pi_1", { key: "r4" })).rejects.toMatchObject({
      code: PAYMENTS_CODE.noPayment,
    });
  });
});

describe("the Connect webhook", () => {
  const secret = "whsec_test";
  const now = new Date("2026-10-30T12:00:00Z");
  const clock = { now: () => now };
  const t = Math.floor(now.getTime() / 1000);
  const body = (event: object) => JSON.stringify(event);
  const paid = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    account: "acct_1",
    data: { object: { id: "pi_1", amount: 5000, amount_received: 5000, currency: "cad", metadata: { booking: "b1" } } },
  };

  function setup() {
    const written: unknown[] = [];
    const store = memoryEventStore();
    const handlers = {
      payment_paid: async (e: { paymentRef: string; accountId: string }) =>
        void written.push(["paid", e.accountId, e.paymentRef]),
      payment_refunded: async (e: { amountRefunded: number }) => void written.push(["refunded", e.amountRefunded]),
      account_updated: async (e: { status: { state: string } }) => void written.push(["account", e.status.state]),
    };
    return { written, config: { secret, clock, store, handlers } };
  }

  it("verifies, routes by account and applies once; a replay is a no-op", async () => {
    const { written, config } = setup();
    const raw = body(paid);
    const sig = signPayload(raw, secret, t);
    expect((await handleConnectWebhook(config, raw, sig)).outcome).toBe("applied");
    expect((await handleConnectWebhook(config, raw, sig)).outcome).toBe("duplicate");
    expect(written).toEqual([["paid", "acct_1", "pi_1"]]);
  });

  it("refuses a bad signature, a stale timestamp and a body that is not JSON", async () => {
    const { written, config } = setup();
    const raw = body(paid);
    await expect(handleConnectWebhook(config, raw, signPayload(raw, "whsec_other", t))).rejects.toMatchObject({
      code: PAYMENTS_CODE.badSignature,
    });
    await expect(handleConnectWebhook(config, raw, signPayload(raw, secret, t - 3600))).rejects.toMatchObject({
      code: PAYMENTS_CODE.badSignature,
    });
    await expect(handleConnectWebhook(config, "nope", signPayload("nope", secret, t))).rejects.toMatchObject({
      code: PAYMENTS_CODE.badSignature,
    });
    expect(written).toEqual([]);
  });

  it("ignores a notification without an account (the platform's own) and a type nobody handles", async () => {
    const { config } = setup();
    const own = body({ ...paid, id: "evt_2", account: undefined });
    expect((await handleConnectWebhook(config, own, signPayload(own, secret, t))).outcome).toBe("ignored");
    const other = body({ ...paid, id: "evt_3", type: "payment_intent.canceled" });
    expect((await handleConnectWebhook(config, other, signPayload(other, secret, t))).outcome).toBe("ignored");
  });

  it("gives the id back when the handler fails, so the retry applies it", async () => {
    const { config } = setup();
    let fails = true;
    const handlers = {
      payment_paid: async () => {
        if (fails) throw new Error("db down");
      },
    };
    const raw = body(paid);
    const sig = signPayload(raw, secret, t);
    await expect(handleConnectWebhook({ ...config, handlers }, raw, sig)).rejects.toThrow("db down");
    fails = false;
    expect((await handleConnectWebhook({ ...config, handlers }, raw, sig)).outcome).toBe("applied");
  });

  it("translates the refund as a cumulative total and the account's state", () => {
    expect(
      translateConnect({
        id: "e",
        type: "charge.refunded",
        account: "acct_1",
        data: { object: { payment_intent: "pi_1", amount_refunded: 300, amount_captured: 1000, currency: "cad" } },
      }),
    ).toMatchObject({ type: "payment_refunded", paymentRef: "pi_1", amountRefunded: 300, amountPaid: 1000 });
    expect(
      translateConnect({
        id: "e",
        type: "account.updated",
        account: "acct_1",
        data: { object: { charges_enabled: true, details_submitted: true } },
      }),
    ).toMatchObject({ type: "account_updated", accountId: "acct_1", status: { state: "active" } });
    expect(
      translateConnect({
        id: "e",
        type: "payment_intent.amount_capturable_updated",
        account: "acct_1",
        data: { object: { id: "pi_2", amount_capturable: 2000, currency: "cad" } },
      }),
    ).toMatchObject({ type: "payment_held", amountMinor: 2000 });
  });
});
