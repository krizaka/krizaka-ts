import { describe, expect, it } from "vitest";

import { translate } from "../src/index";

const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_9", type, data: { object } });

describe("a paid checkout carries its amounts and references", () => {
  it("a one-off payment: the checkout, the payment, the total, the discount, the metadata", () => {
    const out = translate(
      ev("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        customer: "cus_1",
        payment_intent: "pi_1",
        amount_total: 1149,
        currency: "cad",
        total_details: { amount_discount: 250 },
        metadata: { account_id: "a1", kind: "audit", redemption_id: "r7" },
      }),
    );
    expect(out).toEqual({
      id: "evt_9",
      type: "payment_paid",
      kind: "audit",
      accountId: "a1",
      customerId: "cus_1",
      checkoutRef: "cs_1",
      paymentRef: "pi_1",
      invoiceRef: null,
      amountTotal: 1149,
      amountDiscount: 250,
      currency: "cad",
      metadata: { account_id: "a1", kind: "audit", redemption_id: "r7" },
    });
  });
  it("a subscription: the invoice stands for the payment, a missing discount is 0", () => {
    expect(
      translate(
        ev("checkout.session.completed", {
          id: "cs_2",
          mode: "subscription",
          subscription: "sub_1",
          invoice: "in_1",
          amount_total: 3900,
          currency: "cad",
          metadata: { account_id: "a1", redemption_id: "r8" },
        }),
      ),
    ).toMatchObject({
      type: "subscription_started",
      subscriptionId: "sub_1",
      checkoutRef: "cs_2",
      paymentRef: null,
      invoiceRef: "in_1",
      amountTotal: 3900,
      amountDiscount: 0,
      metadata: { redemption_id: "r8" },
    });
  });
  it("a fully discounted checkout (no payment required) is a paid one without a payment reference; nothing invented", () => {
    expect(
      translate(
        ev("checkout.session.completed", {
          id: "cs_3",
          mode: "payment",
          payment_status: "no_payment_required",
          amount_total: 0,
          metadata: { account_id: "a1", kind: "audit" },
        }),
      ),
    ).toMatchObject({
      type: "payment_paid",
      paymentRef: null,
      amountTotal: 0,
      currency: null,
    });
  });
  it("unusable amounts are null or 0, never guessed", () => {
    expect(
      translate(
        ev("checkout.session.completed", {
          id: "",
          mode: "payment",
          payment_status: "paid",
          amount_total: 12.5,
          total_details: { amount_discount: "x" },
          metadata: { account_id: "a1", kind: "audit" },
        }),
      ),
    ).toMatchObject({
      checkoutRef: null,
      amountTotal: null,
      amountDiscount: 0,
    });
  });
});

describe("an expired checkout", () => {
  it("names the session and the metadata, so a reservation is released", () => {
    expect(
      translate(
        ev("checkout.session.expired", { id: "cs_1", client_reference_id: "a1", metadata: { redemption_id: "r7" } }),
      ),
    ).toEqual({
      id: "evt_9",
      type: "checkout_expired",
      checkoutRef: "cs_1",
      accountId: "a1",
      metadata: { redemption_id: "r7" },
    });
    expect(translate(ev("checkout.session.expired", { id: "cs_2", metadata: { account_id: "a2" } }))).toMatchObject({
      accountId: "a2",
    });
    expect(translate(ev("checkout.session.expired", { id: "cs_3" }))).toMatchObject({ accountId: null, metadata: {} });
  });
  it("without a session id, nothing to release", () => {
    expect(translate(ev("checkout.session.expired", {})).type).toBe("ignored");
  });
});

describe("a refund", () => {
  it("is cumulative and names the payment", () => {
    expect(
      translate(
        ev("charge.refunded", {
          id: "ch_1",
          payment_intent: "pi_1",
          invoice: "in_1",
          amount: 1149,
          amount_refunded: 500,
          currency: "cad",
          metadata: { x: "y" },
        }),
      ),
    ).toEqual({
      id: "evt_9",
      type: "payment_refunded",
      paymentRef: "pi_1",
      invoiceRef: "in_1",
      chargeRef: "ch_1",
      amountRefunded: 500,
      amountCharged: 1149,
      currency: "cad",
      metadata: { x: "y" },
    });
  });
  it("a charge with no payment intent still carries what it has", () => {
    expect(translate(ev("charge.refunded", { id: "ch_2", amount_refunded: 0, currency: "cad" }))).toMatchObject({
      paymentRef: null,
      invoiceRef: null,
      amountRefunded: 0,
      amountCharged: 0,
    });
  });
  it("is ignored when it lacks the id, the amount or the currency", () => {
    expect(translate(ev("charge.refunded", { amount_refunded: 1, currency: "cad" })).type).toBe("ignored");
    expect(translate(ev("charge.refunded", { id: "ch", currency: "cad" })).type).toBe("ignored");
    expect(translate(ev("charge.refunded", { id: "ch", amount_refunded: 1 })).type).toBe("ignored");
  });
});
