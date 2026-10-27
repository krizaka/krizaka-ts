import { expect, it } from "vitest";

import { type DeliveryInput, type MailStore, SUPPRESSION_REASON } from "./port";
import { hashAddress } from "./rules";

export const T0 = new Date("2026-10-26T12:00:00.000Z");
const day = (n: number) => new Date(T0.valueOf() + n * 24 * 3600 * 1000);
const entry = (over: Partial<DeliveryInput> = {}) => ({ at: T0, template: "reset", category: "transactional", locale: "fr", to: hashAddress("a@b.co"), status: "sent" as const, ...over });

/** What every `MailStore` adapter must do: the same behaviour behind the same port. `make` gives an empty store. */
export function mailStoreContract(name: string, make: () => MailStore | Promise<MailStore>) {
  it(`${name}: suppresses an address once, keeps the first reason, and lifts it`, async () => {
    const store = await make();
    const h = hashAddress("A@B.co");
    expect(await store.isSuppressed(h)).toBe(false);
    expect(await store.suppress(h, SUPPRESSION_REASON.bounce, T0)).toBe(true);
    expect(await store.suppress(h, SUPPRESSION_REASON.complaint, T0)).toBe(false);
    expect(await store.isSuppressed(hashAddress(" a@b.co "))).toBe(true);
    expect(await store.unsuppress(h)).toBe(true);
    expect(await store.unsuppress(h)).toBe(false);
    expect(await store.isSuppressed(h)).toBe(false);
  });

  it(`${name}: claims an idempotency key once, and gives it back`, async () => {
    const store = await make();
    expect(await store.hasKey("k1")).toBe(false);
    expect(await store.claimKey("k1", T0)).toBe(true);
    expect(await store.claimKey("k1", T0)).toBe(false);
    expect(await store.hasKey("k1")).toBe(true);
    await store.releaseKey("k1");
    expect(await store.hasKey("k1")).toBe(false);
    expect(await store.claimKey("k1", T0)).toBe(true);
  });

  it(`${name}: claims a key once under concurrency`, async () => {
    const store = await make();
    const results = await Promise.all(Array.from({ length: 20 }, () => store.claimKey("race", T0)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it(`${name}: logs newest first, with a hash and never an address`, async () => {
    const store = await make();
    await store.record(entry({ status: "failed", detail: "mailgun answered 500" }));
    await store.record(entry({ at: day(1), status: "sent", messageId: "<m1>", idempotencyKey: "k" }));
    const [first, second] = await store.recent(10);
    expect(first).toMatchObject({ status: "sent", messageId: "<m1>", idempotencyKey: "k", to: hashAddress("a@b.co"), at: day(1).toISOString() });
    expect(second).toMatchObject({ status: "failed", detail: "mailgun answered 500" });
    expect(JSON.stringify(await store.recent(10))).not.toContain("a@b.co");
    expect(await store.recent(1)).toHaveLength(1);
  });

  it(`${name}: purges the log and the keys before a date, and keeps the suppressions`, async () => {
    const store = await make();
    const h = hashAddress("x@y.co");
    await store.record(entry());
    await store.record(entry({ at: day(60) }));
    await store.claimKey("old", T0);
    await store.claimKey("new", day(60));
    await store.suppress(h, SUPPRESSION_REASON.unsubscribed, T0);
    expect(await store.purgeBefore(day(30))).toBe(2);
    expect(await store.recent(10)).toHaveLength(1);
    expect(await store.hasKey("old")).toBe(false);
    expect(await store.hasKey("new")).toBe(true);
    expect(await store.isSuppressed(h)).toBe(true);
  });
}
