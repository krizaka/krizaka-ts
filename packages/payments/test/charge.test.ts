import { describe, expect, it } from "vitest";

import { PAYMENTS_CODE, PaymentsError, processorAdapter } from "../src/index";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const charge = {
  key: "check-42",
  customerId: "cus_1",
  amountMinor: 1200,
  currency: "cad",
  description: "Verification — service Krizaka",
  taxCode: "txcd_10000000",
};

type Answer = (path: string) => Response | undefined;
/** A fake processor recording every call; `answer` overrides a path's reply. */
function fake(answer: Answer = () => undefined, paid: object = {}) {
  const calls: { path: string; method: string; headers: Record<string, string>; form: URLSearchParams }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({
      path,
      method: String(init?.method),
      headers: (init?.headers ?? {}) as Record<string, string>,
      form: new URLSearchParams(String(init?.body ?? "")),
    });
    const forced = answer(path);
    if (forced) return forced;
    if (path === "/v1/invoices") return json({ id: "in_1", status: "draft" });
    if (path === "/v1/invoiceitems") return json({ id: "ii_1" });
    if (path.endsWith("/finalize")) return json({ id: "in_1", status: "open" });
    if (path.endsWith("/pay"))
      return json({
        id: "in_1",
        status: "paid",
        total: 1380,
        currency: "cad",
        tax: 180,
        payment_intent: "pi_1",
        ...paid,
      });
    if (path === "/v1/refunds") return json({ id: "re_1", amount: 1380, currency: "cad" });
    return json({});
  }) as unknown as typeof fetch;
  const at = (path: string) => calls.find((c) => c.path === path)!;
  return {
    calls,
    fetchImpl,
    at,
    adapter: processorAdapter({ secretKey: "test-key", webhookSecret: "whsec-test", plans: {}, fetch: fetchImpl }),
  };
}

describe("a one-off charge", () => {
  it("makes one invoice with one taxed line, finalised and paid, every call keyed", async () => {
    const f = fake();
    const result = await f.adapter.charge(charge);
    expect(result).toEqual({ ref: "in_1", paymentRef: "pi_1", amountTotal: 1380, amountTax: 180, currency: "cad" });
    expect(f.calls.map((c) => c.path)).toEqual([
      "/v1/invoices",
      "/v1/invoiceitems",
      "/v1/invoices/in_1/finalize",
      "/v1/invoices/in_1/pay",
    ]);
    const invoice = f.at("/v1/invoices");
    expect(invoice.form.get("automatic_tax[enabled]")).toBe("true");
    expect(invoice.form.get("pending_invoice_items_behavior")).toBe("exclude");
    expect(invoice.form.get("customer")).toBe("cus_1");
    const item = f.at("/v1/invoiceitems");
    expect(item.form.get("invoice")).toBe("in_1");
    expect(item.form.get("amount")).toBe("1200");
    expect(item.form.get("currency")).toBe("cad");
    expect(item.form.get("tax_code")).toBe("txcd_10000000");
    expect(item.form.get("tax_behavior")).toBe("exclusive");
    expect(item.form.get("description")).toBe("Verification — service Krizaka");
    expect(f.calls.map((c) => c.headers["idempotency-key"])).toEqual([
      "check-42:invoice",
      "check-42:item",
      "check-42:finalize",
      "check-42:pay",
    ]);
  });
  it("omits the tax code when none is given", async () => {
    const f = fake();
    await f.adapter.charge({ ...charge, taxCode: undefined });
    expect(f.at("/v1/invoiceitems").form.has("tax_code")).toBe(false);
  });
  it("reads the tax from the 2025 shape (total_taxes) and the payment from the invoice's payments", async () => {
    const f = fake(
      (path) =>
        path === "/v1/invoice_payments"
          ? json({ data: [{ payment: { type: "payment_intent", payment_intent: "pi_9" } }] })
          : undefined,
      { tax: undefined, total_taxes: [{ amount: 120 }, { amount: 60 }], payment_intent: undefined },
    );
    expect(await f.adapter.charge(charge)).toMatchObject({ amountTax: 180, paymentRef: "pi_9" });
  });
  it.each([
    [0, "cad"],
    [-5, "cad"],
    [12.5, "cad"],
    [1200, "CAD"],
  ])("refuses %s %s before any call", async (amountMinor, currency) => {
    const f = fake();
    await expect(f.adapter.charge({ ...charge, amountMinor, currency })).rejects.toMatchObject({
      code: PAYMENTS_CODE.badMoney,
    });
    expect(f.calls).toHaveLength(0);
  });
  it("voids the invoice and throws PAYMENTS_DECLINED when the card is declined, billing nothing", async () => {
    const f = fake((path) =>
      path.endsWith("/pay")
        ? json({ error: { type: "card_error", message: "Your card was declined." } }, 402)
        : undefined,
    );
    await expect(f.adapter.charge(charge)).rejects.toMatchObject({ status: 402, code: PAYMENTS_CODE.declined });
    expect(f.calls.at(-1)!.path).toBe("/v1/invoices/in_1/void");
  });
  it("throws and leaves the draft when the tax cannot be computed at finalisation (no void of a draft)", async () => {
    const f = fake((path) =>
      path.endsWith("/finalize") ? json({ error: { message: "customer location is not recognized" } }, 400) : undefined,
    );
    const error = await f.adapter.charge(charge).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentsError);
    expect((error as PaymentsError).code).toBe(PAYMENTS_CODE.processor);
    expect(f.calls.some((c) => c.path.endsWith("/pay") || c.path.endsWith("/void"))).toBe(false);
  });
  it("voids the invoice when the payment leaves it open", async () => {
    const f = fake(undefined, { status: "open" });
    await expect(f.adapter.charge(charge)).rejects.toMatchObject({ code: PAYMENTS_CODE.declined });
    expect(f.calls.at(-1)!.path).toBe("/v1/invoices/in_1/void");
  });
  it("still reports the declined payment when the void itself fails", async () => {
    const f = fake((path) =>
      path.endsWith("/pay")
        ? json({ error: { type: "card_error", message: "declined" } }, 402)
        : path.endsWith("/void")
          ? json({ error: { message: "boom" } }, 500)
          : undefined,
    );
    await expect(f.adapter.charge(charge)).rejects.toMatchObject({ code: PAYMENTS_CODE.declined });
  });
});

describe("a refund", () => {
  it("refunds a payment intent in full", async () => {
    const f = fake();
    expect(await f.adapter.refund("pi_1", { key: "refund-check-42" })).toEqual({
      refundRef: "re_1",
      amountRefunded: 1380,
      currency: "cad",
    });
    const call = f.at("/v1/refunds");
    expect(call.form.get("payment_intent")).toBe("pi_1");
    expect(call.form.has("amount")).toBe(false);
    expect(call.headers["idempotency-key"]).toBe("refund-check-42");
  });
  it("refunds a charge, and part of a payment", async () => {
    const f = fake();
    await f.adapter.refund("ch_1", { amountMinor: 500 });
    expect(f.at("/v1/refunds").form.get("charge")).toBe("ch_1");
    expect(f.at("/v1/refunds").form.get("amount")).toBe("500");
  });
  it("finds the payment of an invoice reference first", async () => {
    const f = fake((path) => (path === "/v1/invoices/in_1" ? json({ id: "in_1", payment_intent: "pi_7" }) : undefined));
    await f.adapter.refund("in_1");
    expect(f.at("/v1/refunds").form.get("payment_intent")).toBe("pi_7");
  });
  it("throws PAYMENTS_NO_PAYMENT for an invoice nothing paid", async () => {
    const f = fake((path) =>
      path === "/v1/invoices/in_1"
        ? json({ id: "in_1" })
        : path === "/v1/invoice_payments"
          ? json({ data: [] })
          : undefined,
    );
    await expect(f.adapter.refund("in_1")).rejects.toMatchObject({ code: PAYMENTS_CODE.noPayment });
    expect(f.calls.some((c) => c.path === "/v1/refunds")).toBe(false);
  });
  it("refuses an amount that is not a positive integer", async () => {
    const f = fake();
    await expect(f.adapter.refund("pi_1", { amountMinor: 0 })).rejects.toMatchObject({ code: PAYMENTS_CODE.badMoney });
  });
});
