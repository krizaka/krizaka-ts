import { describe, expect, it } from "vitest";

import { applyOnce, type EventStore, formatPrice, type PaymentEvent, pgEventStore, type Query } from "../src/index";

function memoryStore(): EventStore & { ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    async markSeen(id) {
      if (ids.includes(id)) return false;
      ids.push(id);
      return true;
    },
  };
}
const FACTS = {
  checkoutRef: "cs_1",
  paymentRef: null,
  invoiceRef: "in_1",
  amountTotal: 3900,
  amountDiscount: 0,
  currency: "cad",
  metadata: {},
};
const started: PaymentEvent = {
  id: "evt_1",
  type: "subscription_started",
  accountId: "a1",
  customerId: "cus_1",
  subscriptionId: "sub_1",
  ...FACTS,
};

describe("events are applied once", () => {
  it("a replay runs no handler", async () => {
    const store = memoryStore();
    let runs = 0;
    const handlers = {
      subscription_started: async () => {
        runs++;
      },
    };
    expect(await applyOnce(store, started, handlers)).toBe("applied");
    expect(await applyOnce(store, started, handlers)).toBe("duplicate");
    expect(runs).toBe(1);
  });
  it("an ignored event is not even recorded", async () => {
    const store = memoryStore();
    expect(await applyOnce(store, { id: "evt_x", type: "ignored" }, {})).toBe("ignored");
    expect(store.ids).toEqual([]);
  });
  it("a handler may say the event concerned nobody; an absent handler ignores the type", async () => {
    const store = memoryStore();
    const changed: PaymentEvent = {
      id: "evt_2",
      type: "subscription_changed",
      accountId: null,
      customerId: null,
      subscriptionId: "s",
      status: "active",
      active: true,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    };
    expect(await applyOnce(store, changed, { subscription_changed: async () => "ignored" as const })).toBe("ignored");
    expect(
      await applyOnce(
        store,
        { id: "evt_3", type: "payment_paid", kind: "audit", accountId: "a", customerId: null, ...FACTS },
        {},
      ),
    ).toBe("ignored");
  });
  it("the handler receives the narrowed event", async () => {
    let got: string | undefined;
    await applyOnce(
      memoryStore(),
      { id: "evt_4", type: "payment_paid", kind: "audit", accountId: "a9", customerId: null, ...FACTS },
      {
        payment_paid: async (e) => {
          got = `${e.kind}:${e.accountId}`;
        },
      },
    );
    expect(got).toBe("audit:a9");
  });
});

describe("the SQL event store", () => {
  it("records the id first and reports a conflict as already seen", async () => {
    const calls: { text: string; values: unknown[] | undefined }[] = [];
    let fresh = true;
    const store = pgEventStore((async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return fresh ? [{ id: "evt_1" }] : [];
    }) as Query);
    expect(await store.markSeen("evt_1", "subscription_started")).toBe(true);
    fresh = false;
    expect(await store.markSeen("evt_1", "subscription_started")).toBe(false);
    expect(calls[0]!.text).toContain("INSERT INTO public.payment_events");
    expect(calls[0]!.text).toContain("ON CONFLICT (id) DO NOTHING RETURNING id");
    expect(calls[0]!.values).toEqual(["evt_1", "subscription_started"]);
  });
});

describe("the price, in the visitor's language", () => {
  const price = { amount: 3900, currency: "cad", interval: "month" as const };
  it("formats whole amounts without cents, in each locale's convention", () => {
    expect(formatPrice(price, "en")).toBe("$39");
    expect(formatPrice(price, "fr").replace(/\s/g, " ")).toBe("39 $");
  });
  it("keeps the cents when there are some", () => {
    expect(formatPrice({ amount: 999, currency: "cad", interval: null }, "en")).toBe("$9.99");
    expect(formatPrice({ amount: 999, currency: "cad", interval: null }, "fr").replace(/\s/g, " ")).toBe("9,99 $");
  });
});
