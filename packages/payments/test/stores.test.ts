import { checksumOf } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { adoptPaymentEventsSql, announcePayment, memoryDiscountStore, memoryEventStore, messageIdOf, type OutboxPort, PAYMENT_TOPIC, type PaymentEvent, paymentsSchema, type Query } from "../src/index";
import { paymentsSettings, readPaymentsSettings } from "../src/settings";
import { discountStoreContract, eventStoreContract } from "../src/testkit";

eventStoreContract("memory", () => memoryEventStore());
discountStoreContract("memory", () => memoryDiscountStore());

describe("the memory stores", () => {
  it("lists the ids it holds", async () => {
    const store = memoryEventStore();
    await store.markSeen("a", "t");
    expect(store.ids()).toEqual(["a"]);
  });
});

describe("announcing a payment through the outbox", () => {
  const recorded: { topic: string; type: string; payload: unknown; id?: string }[] = [];
  const ids = new Set<string>();
  const outbox: OutboxPort = {
    async append(_tx, m) {
      recorded.push(m);
      const id = m.id ?? "none";
      const appended = !ids.has(id);
      ids.add(id);
      return { id, appended };
    },
  };
  const tx = (async () => []) as unknown as Query;
  const refunded: PaymentEvent = { id: "evt_r", type: "payment_refunded", paymentRef: "pi_1", invoiceRef: null, chargeRef: "ch_1", amountRefunded: 500, amountCharged: 1149, currency: "cad", metadata: {} };

  it("appends one message on the payments topic with a stable id and the event's facts", async () => {
    expect(await announcePayment(tx, outbox, refunded)).toBe(true);
    expect(recorded[0]).toMatchObject({ topic: PAYMENT_TOPIC, type: "evt.payment.refunded.v1", id: messageIdOf("evt_r"), payload: { eventId: "evt_r", paymentRef: "pi_1", amountRefunded: 500 } });
    expect(recorded[0]!.payload).not.toHaveProperty("type");
  });
  it("announces the same event once", async () => {
    expect(await announcePayment(tx, outbox, refunded)).toBe(false);
  });
  it("names every kind of event, and announces nothing for an ignored one", async () => {
    const types: PaymentEvent[] = [
      { id: "e1", type: "checkout_expired", checkoutRef: "cs", accountId: null, metadata: {} },
      { id: "e2", type: "subscription_changed", accountId: null, customerId: null, subscriptionId: "s", status: "active", active: true, periodEnd: null },
      { id: "e3", type: "payment_paid", kind: "k", accountId: "a", customerId: null, checkoutRef: null, paymentRef: null, invoiceRef: null, amountTotal: 0, amountDiscount: 0, currency: null, metadata: {} },
      { id: "e4", type: "subscription_started", accountId: "a", customerId: null, subscriptionId: null, checkoutRef: null, paymentRef: null, invoiceRef: null, amountTotal: 0, amountDiscount: 0, currency: null, metadata: {} },
    ];
    for (const e of types) await announcePayment(tx, outbox, e);
    expect(recorded.slice(2).map((m) => m.type)).toEqual(["evt.payment.checkout-expired.v1", "evt.payment.subscription-changed.v1", "evt.payment.paid.v1", "evt.payment.subscription-started.v1"]);
    const before = recorded.length;
    expect(await announcePayment(tx, outbox, { id: "i", type: "ignored" })).toBe(false);
    expect(recorded).toHaveLength(before);
  });
  it("derives a UUID from the event id: stable, valid, distinct", () => {
    const id = messageIdOf("evt_1");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(messageIdOf("evt_1")).toBe(id);
    expect(messageIdOf("evt_2")).not.toBe(id);
  });
});

describe("the module's schema", () => {
  it("version 1 is frozen: its checksum is pinned", () => {
    expect(checksumOf(paymentsSchema, 1, { tables: {} })).toMatchInlineSnapshot(`"f4177a35d05450c0f9696cedb9b2dc681ec3ab9cd3739013f8b7675b7e6fbb33"`);
  });
  it("adopts a product's payment_events by moving the table, idempotently", () => {
    const sql = adoptPaymentEventsSql();
    expect(sql).toContain("ALTER TABLE public.payment_events SET SCHEMA payments");
    expect(sql).toContain("RENAME TO event");
    expect(sql).toContain("to_regclass('payments.event') IS NULL");
    expect(() => adoptPaymentEventsSql("public; drop", "payments")).toThrow(/safe SQL identifier/);
    expect(() => adoptPaymentEventsSql("public", "Pay")).toThrow(/safe SQL identifier/);
  });
});

describe("the settings fragment", () => {
  it("registers the webhook tolerance with its bounds, and reads it with a default", async () => {
    expect(paymentsSettings["payments.webhookToleranceSeconds"]).toMatchObject({ default: 300, min: 30, max: 900, unit: "seconds" });
    expect(await readPaymentsSettings(() => undefined)).toEqual({ webhookToleranceSeconds: 300 });
    expect(await readPaymentsSettings(() => 60)).toEqual({ webhookToleranceSeconds: 60 });
  });
});
