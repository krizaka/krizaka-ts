import { describe, expect, it } from "vitest";

import { createCredits, CREDITS_DEFAULTS, memoryCreditStore, type OutboxPort, type Query } from "../src";
import { creditsLedgerContract, type LedgerHarness, T0 } from "../src/testkit";

/** The ledger on the in-memory store: the same contract the database runs. */
export function memoryHarness(): LedgerHarness {
  const store = memoryCreditStore();
  let now = T0;
  const announced: ReturnType<LedgerHarness["announced"]> = [];
  const seen = new Set<string>();
  const outbox: OutboxPort = {
    async append(_tx, m) {
      const id = m.id ?? "";
      const appended = !seen.has(id);
      seen.add(id);
      if (appended) announced.push({ type: m.type, id: m.id, payload: m.payload as Record<string, unknown> });
      return { id, appended };
    },
  };
  let n = 0;
  const credits = createCredits({
    clock: { now: () => now },
    settings: CREDITS_DEFAULTS,
    storeFor: () => store,
    outbox,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  return {
    credits,
    tx: (async () => []) as unknown as Query,
    setNow: (d) => void (now = d),
    newAccount: async () => `acc-${++n}`,
    announced: () => announced,
  };
}

creditsLedgerContract("memory", async () => memoryHarness());

describe("the memory store", () => {
  it("refuses a duplicate idempotency key, as the database's unique key does", async () => {
    const store = memoryCreditStore();
    const line = {
      id: "e1",
      accountId: "a",
      grantId: null,
      type: "GRANT",
      amount: 1,
      reason: "r",
      operation: "o",
      idempotencyKey: "o:0",
      reverses: null,
      holdId: null,
      at: T0,
    } as const;
    await store.insertEntries([line]);
    await expect(store.insertEntries([{ ...line, id: "e2" }])).rejects.toThrow(/duplicate idempotency key/);
    expect(store.entries()).toHaveLength(1);
  });
});

describe("the ledger's refusals before any store call", () => {
  const credits = () => memoryHarness();
  const bad = async (work: (h: LedgerHarness, a: string) => Promise<unknown>) => {
    const h = credits();
    const a = await h.newAccount();
    return work(h, a).then(
      () => "answered",
      (e: { code: string }) => e.code,
    );
  };
  const base = (a: string) => ({
    accountId: a,
    amount: 1,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    onExhausted: "stop" as const,
    source: "s",
    idempotencyKey: "k",
  });
  it("a grant must lapse in the future, have an account, a source, sane caps and a known exhaustion", async () => {
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), expiresAt: T0 }))).toBe("CREDITS_BAD_GRANT");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), expiresAt: new Date("nope") }))).toBe(
      "CREDITS_BAD_GRANT",
    );
    expect(await bad((h) => h.credits.grant(h.tx, { ...base(""), accountId: "" }))).toBe("CREDITS_BAD_GRANT");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), source: "" }))).toBe("CREDITS_BAD_GRANT");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), source: "x".repeat(201) }))).toBe(
      "CREDITS_BAD_GRANT",
    );
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), capPerDay: 0 }))).toBe("CREDITS_BAD_AMOUNT");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), capPerMonth: 1.5 }))).toBe("CREDITS_BAD_AMOUNT");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), onExhausted: "keep" as never }))).toBe(
      "CREDITS_BAD_GRANT",
    );
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), amount: 0 }))).toBe("CREDITS_BAD_AMOUNT");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), idempotencyKey: "a:b" }))).toBe("CREDITS_BAD_KEY");
    expect(await bad((h, a) => h.credits.grant(h.tx, { ...base(a), capPerDay: null, capPerMonth: null }))).toBe(
      "answered",
    );
  });
  it("a consume, a hold, a refund and an adjustment name what they need", async () => {
    expect(
      await bad((h, a) => h.credits.consume(h.tx, { accountId: a, amount: 1, reason: "", idempotencyKey: "k" })),
    ).toBe("CREDITS_BAD_GRANT");
    expect(
      await bad((h, a) =>
        h.credits.consume(h.tx, { accountId: a, amount: 1, reason: "r".repeat(301), idempotencyKey: "k" }),
      ),
    ).toBe("CREDITS_BAD_GRANT");
    expect(
      await bad((h, a) => h.credits.consume(h.tx, { accountId: a, amount: -1, reason: "r", idempotencyKey: "k" })),
    ).toBe("CREDITS_BAD_AMOUNT");
    expect(
      await bad((h, a) => h.credits.hold(h.tx, { accountId: a, amount: 1, ttlSeconds: 1, idempotencyKey: "k" })),
    ).toBe("CREDITS_BAD_SETTINGS");
    expect(await bad((h, a) => h.credits.hold(h.tx, { accountId: a, amount: 0, idempotencyKey: "k" }))).toBe(
      "CREDITS_BAD_AMOUNT",
    );
    expect(await bad((h, a) => h.credits.refund(h.tx, { accountId: a, reason: "r" }))).toBe("CREDITS_BAD_KEY");
    expect(await bad((h, a) => h.credits.refund(h.tx, { accountId: a, consumed: "k", reason: "" }))).toBe(
      "CREDITS_BAD_GRANT",
    );
    expect(
      await bad((h, a) =>
        h.credits.adjust(h.tx, { accountId: a, grantId: "g", amount: 0, reason: "r", idempotencyKey: "k" }),
      ),
    ).toBe("CREDITS_BAD_AMOUNT");
    expect(
      await bad((h, a) =>
        h.credits.adjust(h.tx, { accountId: a, grantId: "g", amount: 1, reason: "", idempotencyKey: "k" }),
      ),
    ).toBe("CREDITS_BAD_GRANT");
    expect(await bad((h) => h.credits.expire(h.tx, "nope"))).toBe("CREDITS_UNKNOWN_GRANT");
  });
  it("the settings are read at each call, from an object or a function, and a bad zone refuses", async () => {
    const store = memoryCreditStore();
    let zone = "America/Toronto";
    const credits = createCredits({
      clock: { now: () => T0 },
      settings: () => ({ timeZone: zone, holdTtlSeconds: 900 }),
      storeFor: () => store,
    });
    const tx = (async () => []) as unknown as Query;
    await credits.grant(tx, {
      accountId: "a",
      amount: 1,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      onExhausted: "stop",
      source: "s",
      idempotencyKey: "k",
    });
    expect((await credits.balance(tx, "a")).total).toBe(1);
    zone = "Mars/Olympus";
    await expect(credits.balance(tx, "a")).rejects.toThrow(/IANA/);
  });
  it("works without an outbox and with the default ids", async () => {
    const store = memoryCreditStore();
    const credits = createCredits({ clock: { now: () => T0 }, settings: CREDITS_DEFAULTS, storeFor: () => store });
    const tx = (async () => []) as unknown as Query;
    const { grantId } = await credits.grant(tx, {
      accountId: "a",
      amount: 1,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      onExhausted: "stop",
      source: "s",
      idempotencyKey: "k",
    });
    expect(grantId).toMatch(/^[0-9a-f-]{36}$/);
    await credits.consume(tx, { accountId: "a", amount: 1, reason: "r", idempotencyKey: "c" });
  });
});
