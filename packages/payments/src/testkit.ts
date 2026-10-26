import { expect, it } from "vitest";

import type { EventStore } from "./events";
import type { DiscountStore } from "./port";

/** What every `EventStore` must do: record an id once, answer a replay `false`, give an id back so a retry applies it. `make` gives an empty store. */
export function eventStoreContract(name: string, make: () => Required<EventStore> | Promise<Required<EventStore>>) {
  it(`${name}: records an id once and answers a replay false`, async () => {
    const store = await make();
    expect(await store.markSeen("evt_1", "payment_paid")).toBe(true);
    expect(await store.markSeen("evt_1", "payment_paid")).toBe(false);
    expect(await store.markSeen("evt_2", "payment_paid")).toBe(true);
  });
  it(`${name}: gives an id back, so the retry is new again`, async () => {
    const store = await make();
    await store.markSeen("evt_1", "payment_paid");
    await store.forget("evt_1");
    expect(await store.markSeen("evt_1", "payment_paid")).toBe(true);
    await store.forget("evt_never_seen");
  });
}

/** What every `DiscountStore` must do: one object per `(coupon, terms version, provider)`, the first remembered wins. */
export function discountStoreContract(name: string, make: () => DiscountStore | Promise<DiscountStore>) {
  it(`${name}: finds nothing before it remembers, then the reference`, async () => {
    const store = await make();
    expect(await store.find("c1", 1, "stripe")).toBeNull();
    expect(await store.remember("c1", 1, "stripe", "co_a")).toBe("co_a");
    expect(await store.find("c1", 1, "stripe")).toBe("co_a");
  });
  it(`${name}: keeps the first reference when the same terms are remembered twice (a race makes one object)`, async () => {
    const store = await make();
    expect(await store.remember("c1", 1, "stripe", "co_a")).toBe("co_a");
    expect(await store.remember("c1", 1, "stripe", "co_b")).toBe("co_a");
    expect(await store.find("c1", 1, "stripe")).toBe("co_a");
  });
  it(`${name}: tells terms versions, coupons and providers apart`, async () => {
    const store = await make();
    await store.remember("c1", 1, "stripe", "co_a");
    expect(await store.find("c1", 2, "stripe")).toBeNull();
    expect(await store.find("c2", 1, "stripe")).toBeNull();
    expect(await store.find("c1", 1, "other")).toBeNull();
  });
}
