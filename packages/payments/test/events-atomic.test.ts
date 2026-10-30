import { describe, expect, it } from "vitest";

import {
  applyOnce,
  applyOnceInTransaction,
  type EventStore,
  type PaymentEvent,
  pgEventStore,
  type Query,
} from "../src/index";

export const FACTS = {
  checkoutRef: "cs_1",
  paymentRef: "pi_1",
  invoiceRef: null,
  amountTotal: 1149,
  amountDiscount: 0,
  currency: "cad",
  metadata: {},
};
const paid: PaymentEvent = {
  id: "evt_paid",
  type: "payment_paid",
  kind: "audit",
  accountId: "a1",
  customerId: "cus_1",
  ...FACTS,
};

/** A store that remembers ids and can forget them, like `pgEventStore` on a real table. */
function forgettingStore(): EventStore & { ids: Set<string> } {
  const ids = new Set<string>();
  return {
    ids,
    async markSeen(id) {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
    async forget(id) {
      ids.delete(id);
    },
  };
}

describe("a handler that fails leaves the event unrecorded (krizaka-ts#47: the applyOnce gap)", () => {
  it("the failure propagates, the id is given back, and the provider's retry applies the event", async () => {
    const store = forgettingStore();
    let credited = 0;
    let down = true;
    const handlers = {
      payment_paid: async () => {
        if (down) throw new Error("database unavailable");
        credited++;
      },
    };

    await expect(applyOnce(store, paid, handlers)).rejects.toThrow("database unavailable");
    expect(store.ids.has(paid.id)).toBe(false);

    down = false;
    expect(await applyOnce(store, paid, handlers)).toBe("applied");
    expect(credited).toBe(1);
    expect(await applyOnce(store, paid, handlers)).toBe("duplicate");
    expect(credited).toBe(1);
  });

  it("a store without `forget` still sees the failure (older stores keep working)", async () => {
    const ids: string[] = [];
    const store: EventStore = {
      async markSeen(id) {
        if (ids.includes(id)) return false;
        ids.push(id);
        return true;
      },
    };
    await expect(
      applyOnce(store, paid, {
        payment_paid: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });

  it("when giving the id back fails too, both failures reach the caller (the handler's first)", async () => {
    const handlerError = new Error("handler failed");
    const cleanupError = new Error("database down");
    const store: EventStore = {
      async markSeen() {
        return true;
      },
      async forget() {
        throw cleanupError;
      },
    };
    const failure = await applyOnce(store, paid, {
      payment_paid: async () => {
        throw handlerError;
      },
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([handlerError, cleanupError]);
    expect((failure as AggregateError).cause).toBe(cleanupError);
  });

  it("the SQL store forgets with a DELETE on its own row", async () => {
    const calls: { text: string; values: unknown[] | undefined }[] = [];
    const store = pgEventStore(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return [];
    });
    await store.forget!("evt_1");
    expect(calls[0]!.text).toBe("DELETE FROM public.payment_events WHERE id = $1");
    expect(calls[0]!.values).toEqual(["evt_1"]);
  });
});

/**
 * A fake database with real transaction semantics: the work sees its own writes; they become visible only when it returns,
 * and vanish when it throws. Enough to prove that the record and the effect commit or roll back together.
 */
function fakeDatabase() {
  const committed = { events: new Set<string>(), credits: 0 };
  const transaction = async <T>(work: (query: Query) => Promise<T>): Promise<T> => {
    const pending = { events: new Set(committed.events), credits: committed.credits };
    const query = (async (text: string, values?: unknown[]) => {
      if (text.startsWith("INSERT INTO payments.event")) {
        const id = String(values![0]);
        if (pending.events.has(id)) return [];
        pending.events.add(id);
        return [{ id }];
      }
      if (text === "UPDATE credits") {
        pending.credits++;
        return [];
      }
      throw new Error(`unexpected SQL: ${text}`);
    }) as Query;
    const result = await work(query);
    committed.events = pending.events;
    committed.credits = pending.credits;
    return result;
  };
  return { committed, transaction };
}

describe("applyOnceInTransaction: the record and the effect in one transaction", () => {
  it("commits both together, and a replay changes nothing", async () => {
    const db = fakeDatabase();
    const handlers = {
      payment_paid: async (_event: Extract<PaymentEvent, { type: "payment_paid" }>, query: Query) => {
        await query("UPDATE credits");
      },
    };
    expect(await applyOnceInTransaction(db.transaction, paid, handlers)).toBe("applied");
    expect(await applyOnceInTransaction(db.transaction, paid, handlers)).toBe("duplicate");
    expect(db.committed).toEqual({ events: new Set([paid.id]), credits: 1 });
  });

  it("rolls both back when the handler fails, so the retry applies the event", async () => {
    const db = fakeDatabase();
    let down = true;
    const handlers = {
      payment_paid: async (_event: Extract<PaymentEvent, { type: "payment_paid" }>, query: Query) => {
        await query("UPDATE credits");
        if (down) throw new Error("the effect failed half-way");
      },
    };
    await expect(applyOnceInTransaction(db.transaction, paid, handlers)).rejects.toThrow("half-way");
    expect(db.committed).toEqual({ events: new Set(), credits: 0 });

    down = false;
    expect(await applyOnceInTransaction(db.transaction, paid, handlers)).toBe("applied");
    expect(db.committed).toEqual({ events: new Set([paid.id]), credits: 1 });
  });

  it("an ignored event, or a type without handler, opens no transaction", async () => {
    let opened = 0;
    const transaction = async <T>(work: (query: Query) => Promise<T>): Promise<T> => {
      opened++;
      return work(async () => []);
    };
    expect(await applyOnceInTransaction(transaction, { id: "evt_x", type: "ignored" }, {})).toBe("ignored");
    expect(await applyOnceInTransaction(transaction, paid, {})).toBe("ignored");
    expect(opened).toBe(0);
  });

  it("a handler may answer that the event concerned nobody", async () => {
    const db = fakeDatabase();
    expect(await applyOnceInTransaction(db.transaction, paid, { payment_paid: async () => "ignored" as const })).toBe(
      "ignored",
    );
    expect(db.committed.events.has(paid.id)).toBe(true);
  });
});
