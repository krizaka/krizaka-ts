import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import type { Credits } from "./credits";
import { type CreditsCode, ENTRY_TYPE, ON_EXHAUSTED, type Query } from "./port";

/** What a store (through the ledger) is run against: the ledger on that store, a clock the test moves, and accounts that exist for it. */
export interface LedgerHarness {
  credits: Credits;
  /** The query every call goes through (the transaction; a no-op for memory). */
  tx: Query;
  /** Moves the injected clock. */
  setNow(instant: Date): void;
  /** A fresh account id (a row in the owner table, when the store has one). */
  newAccount(): Promise<string>;
  /** The messages appended to the outbox so far. */
  announced(): { type: string; id: string | undefined; payload: Record<string, unknown> }[];
}

/** Midday on 26 October 2026 in Toronto (16:00 UTC): the day the scenarios start on. */
export const T0 = new Date("2026-10-26T16:00:00.000Z");
const plus = (instant: Date, seconds: number) => new Date(instant.valueOf() + seconds * 1000);
const DAY = 86_400;

async function refusal(work: Promise<unknown>): Promise<CreditsCode> {
  try {
    await work;
  } catch (error) {
    return (error as { code: CreditsCode }).code;
  }
  throw new Error("expected a refusal, got an answer");
}

/**
 * What every credits store must do, behind the same ledger: derived balances, the order of draws, idempotency, the caps of the day and
 * the month in the configured zone, expiry, `stop` against `fallback_paid`, holds, refunds. `make` gives an EMPTY ledger and the clock
 * at {@link T0}, time zone `America/Toronto`, hold lifetime 900 seconds.
 */
export function creditsLedgerContract(name: string, make: () => Promise<LedgerHarness>) {
  const grant = (h: LedgerHarness, accountId: string, over: Partial<Parameters<Credits["grant"]>[1]> = {}) =>
    h.credits.grant(h.tx, {
      accountId,
      amount: 10,
      expiresAt: plus(T0, 30 * DAY),
      onExhausted: ON_EXHAUSTED.stop,
      source: "coupon:test",
      idempotencyKey: randomUUID(),
      ...over,
    });
  const buy = (h: LedgerHarness, accountId: string, amount: number) =>
    h.credits.purchase(h.tx, { accountId, amount, source: "purchase:pi_1", idempotencyKey: randomUUID() });
  const consume = (h: LedgerHarness, accountId: string, amount: number, idempotencyKey: string = randomUUID()) =>
    h.credits.consume(h.tx, { accountId, amount, reason: "audit:1", idempotencyKey });

  it(`${name}: derives the balance from the ledger: a grant and a purchase, the history newest first`, async () => {
    const h = await make();
    const a = await h.newAccount();
    expect(await h.credits.balance(h.tx, a)).toMatchObject({ total: 0, available: 0, grants: [] });
    await grant(h, a, { amount: 5 });
    await buy(h, a, 7);
    expect(await h.credits.balance(h.tx, a)).toMatchObject({
      total: 12,
      granted: 5,
      purchased: 7,
      held: 0,
      available: 12,
    });
    const lines = await h.credits.history(h.tx, a);
    expect(lines.map((l) => [l.type, l.amount])).toEqual([
      [ENTRY_TYPE.purchase, 7],
      [ENTRY_TYPE.grant, 5],
    ]);
  });

  it(`${name}: a grant or a purchase with a key seen before changes nothing`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const first = await grant(h, a, { idempotencyKey: "g-1", amount: 4 });
    const again = await grant(h, a, { idempotencyKey: "g-1", amount: 4 });
    expect(again).toEqual({ grantId: first.grantId, replayed: true });
    const p = await h.credits.purchase(h.tx, { accountId: a, amount: 3, source: "purchase:x", idempotencyKey: "p-1" });
    expect(
      (await h.credits.purchase(h.tx, { accountId: a, amount: 3, source: "purchase:x", idempotencyKey: "p-1" }))
        .grantId,
    ).toBe(p.grantId);
    expect((await h.credits.balance(h.tx, a)).total).toBe(7);
    expect(await h.credits.history(h.tx, a)).toHaveLength(2);
  });

  it(`${name}: refuses a key already used by another account`, async () => {
    const h = await make();
    const [a, b] = [await h.newAccount(), await h.newAccount()];
    await grant(h, a, { idempotencyKey: "shared" });
    expect(await refusal(grant(h, b, { idempotencyKey: "shared" }))).toBe("CREDITS_KEY_REUSED");
    await consume(h, a, 1, "c-shared");
    expect(await refusal(consume(h, b, 1, "c-shared"))).toBe("CREDITS_KEY_REUSED");
  });

  it(`${name}: spends from the pot that lapses first, then the next; purchased credits last`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const late = await grant(h, a, {
      amount: 5,
      expiresAt: plus(T0, 20 * DAY),
      onExhausted: ON_EXHAUSTED.fallbackPaid,
    });
    const soon = await grant(h, a, { amount: 3, expiresAt: plus(T0, 5 * DAY), onExhausted: ON_EXHAUSTED.fallbackPaid });
    const paid = await buy(h, a, 10);
    const out = await consume(h, a, 4);
    expect(out.draws).toEqual([
      { grantId: soon.grantId, amount: 3 },
      { grantId: late.grantId, amount: 1 },
    ]);
    const rest = await consume(h, a, 4 + 4 + 1);
    expect(rest.draws).toEqual([
      { grantId: late.grantId, amount: 4 },
      { grantId: paid.grantId, amount: 5 },
    ]);
  });

  it(`${name}: a consume with a key seen before answers the first answer and spends nothing more`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 5 });
    const first = await consume(h, a, 2, "job-1");
    const again = await consume(h, a, 2, "job-1");
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ draws: first.draws, replayed: true });
    expect((await h.credits.balance(h.tx, a)).total).toBe(3);
  });

  it(`${name}: no credits at all is a PAYWALL, and a refusal writes nothing`, async () => {
    const h = await make();
    const a = await h.newAccount();
    expect(await refusal(consume(h, a, 1))).toBe("PAYWALL");
    await buy(h, a, 2);
    expect(await refusal(consume(h, a, 3))).toBe("PAYWALL");
    expect((await h.credits.balance(h.tx, a)).total).toBe(2);
    expect(await h.credits.history(h.tx, a)).toHaveLength(1);
  });

  it(`${name}: a stop pot that is empty answers CREDITS_EXHAUSTED even if purchased credits exist; fallback_paid moves on to them`, async () => {
    const h = await make();
    const [stop, fall] = [await h.newAccount(), await h.newAccount()];
    await grant(h, stop, { amount: 2, onExhausted: ON_EXHAUSTED.stop });
    await buy(h, stop, 5);
    await consume(h, stop, 2);
    expect(await refusal(consume(h, stop, 1))).toBe("CREDITS_EXHAUSTED");
    expect(await refusal(consume(h, stop, 3))).toBe("CREDITS_EXHAUSTED");
    expect((await h.credits.balance(h.tx, stop)).purchased).toBe(5);

    await grant(h, fall, { amount: 2, onExhausted: ON_EXHAUSTED.fallbackPaid });
    await buy(h, fall, 5);
    const out = await consume(h, fall, 4);
    expect(out.draws).toHaveLength(2);
    expect(out.draws.map((d) => d.amount)).toEqual([2, 2]);
    const none = await h.newAccount();
    await grant(h, none, { amount: 1, onExhausted: ON_EXHAUSTED.fallbackPaid });
    await consume(h, none, 1);
    expect(await refusal(consume(h, none, 1))).toBe("PAYWALL");
  });

  it(`${name}: the daily cap holds, and a new calendar day in the configured zone opens it again`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 20, capPerDay: 3 });
    await consume(h, a, 2);
    expect(await refusal(consume(h, a, 2))).toBe("CREDITS_CAP_DAY");
    await consume(h, a, 1);
    // 23:30 in Toronto is still the same day; 00:30 is the next one
    h.setNow(new Date("2026-10-27T03:30:00.000Z"));
    expect(await refusal(consume(h, a, 1))).toBe("CREDITS_CAP_DAY");
    h.setNow(new Date("2026-10-27T04:30:00.000Z"));
    const next = await consume(h, a, 3);
    expect(next.draws.reduce((n, d) => n + d.amount, 0)).toBe(3);
    expect(await refusal(consume(h, a, 1))).toBe("CREDITS_CAP_DAY");
  });

  it(`${name}: the monthly cap holds across the month boundary of the zone (daylight saving ends that night)`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 50, capPerMonth: 4, expiresAt: plus(T0, 60 * DAY) });
    h.setNow(new Date("2026-10-31T10:00:00.000Z"));
    await consume(h, a, 4);
    h.setNow(new Date("2026-11-01T03:59:59.000Z")); // 23:59:59 on 31 October in Toronto
    expect(await refusal(consume(h, a, 1))).toBe("CREDITS_CAP_MONTH");
    h.setNow(new Date("2026-11-01T04:00:00.000Z")); // midnight, 1 November
    await consume(h, a, 4);
    expect(await refusal(consume(h, a, 1))).toBe("CREDITS_CAP_MONTH");
  });

  it(`${name}: the cap of one pot does not stop the next pot`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const capped = await grant(h, a, { amount: 10, capPerDay: 2, expiresAt: plus(T0, 5 * DAY) });
    const open = await grant(h, a, { amount: 10, expiresAt: plus(T0, 9 * DAY) });
    const out = await consume(h, a, 5);
    expect(out.draws).toEqual([
      { grantId: capped.grantId, amount: 2 },
      { grantId: open.grantId, amount: 3 },
    ]);
  });

  it(`${name}: a pot is not spendable after its date, and expire() writes off what is left once`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const g = await grant(h, a, { amount: 6, expiresAt: plus(T0, DAY), onExhausted: ON_EXHAUSTED.fallbackPaid });
    await consume(h, a, 2);
    h.setNow(plus(T0, DAY));
    expect((await h.credits.balance(h.tx, a)).total).toBe(0);
    expect(await refusal(consume(h, a, 1))).toBe("PAYWALL");
    expect(await h.credits.expire(h.tx, g.grantId)).toEqual({ expired: 4 });
    expect(await h.credits.expire(h.tx, g.grantId)).toEqual({ expired: 0 });
    expect((await h.credits.history(h.tx, a)).map((l) => [l.type, l.amount])).toEqual([
      [ENTRY_TYPE.expiry, -4],
      [ENTRY_TYPE.debit, -2],
      [ENTRY_TYPE.grant, 6],
    ]);
  });

  it(`${name}: a revoked pot (expire before its date) gives nothing, and a stop pot closed this way does not block purchased credits`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const g = await grant(h, a, { amount: 3, onExhausted: ON_EXHAUSTED.stop });
    await buy(h, a, 2);
    await h.credits.expire(h.tx, g.grantId);
    expect((await h.credits.balance(h.tx, a)).total).toBe(2);
    expect((await consume(h, a, 2)).draws).toHaveLength(1);
  });

  it(`${name}: the sweep closes lapsed pots that still hold credits, oldest first, and skips closed ones`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 3, expiresAt: plus(T0, DAY) });
    await grant(h, a, { amount: 2, expiresAt: plus(T0, 2 * DAY) });
    await grant(h, a, { amount: 9, expiresAt: plus(T0, 10 * DAY) });
    h.setNow(plus(T0, 3 * DAY));
    expect(await h.credits.expireDue(h.tx)).toBe(2);
    expect(await h.credits.expireDue(h.tx)).toBe(0);
    expect((await h.credits.balance(h.tx, a)).total).toBe(9);
  });

  it(`${name}: a hold keeps credits back from others, settles for the real cost, and the rest is free again`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 5 });
    const hold = await h.credits.hold(h.tx, { accountId: a, amount: 4, idempotencyKey: "h-1" });
    expect(hold.replayed).toBe(false);
    expect((await h.credits.hold(h.tx, { accountId: a, amount: 4, idempotencyKey: "h-1" })).holdId).toBe(hold.holdId);
    expect(await h.credits.balance(h.tx, a)).toMatchObject({ total: 5, held: 4, available: 1 });
    expect(await refusal(consume(h, a, 2))).toBe("CREDITS_EXHAUSTED");
    expect((await consume(h, a, 1)).draws).toHaveLength(1);
    const settled = await h.credits.settle(h.tx, hold.holdId, { amount: 3, reason: "audit:9" });
    expect(settled.draws.reduce((n, d) => n + d.amount, 0)).toBe(3);
    expect(await h.credits.balance(h.tx, a)).toMatchObject({ total: 1, held: 0 });
    expect(await h.credits.settle(h.tx, hold.holdId)).toMatchObject({ replayed: true });
    expect((await h.credits.balance(h.tx, a)).total).toBe(1);
    expect(await refusal(h.credits.release(h.tx, hold.holdId))).toBe("CREDITS_HOLD_CLOSED");
  });

  it(`${name}: a hold counts against the caps, a hold that cannot be covered is refused, and a release frees it`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 10, capPerDay: 3 });
    const hold = await h.credits.hold(h.tx, { accountId: a, amount: 3, idempotencyKey: "h-1" });
    expect(await refusal(h.credits.hold(h.tx, { accountId: a, amount: 1, idempotencyKey: "h-2" }))).toBe(
      "CREDITS_CAP_DAY",
    );
    await h.credits.release(h.tx, hold.holdId);
    await h.credits.release(h.tx, hold.holdId);
    expect(await refusal(h.credits.settle(h.tx, hold.holdId))).toBe("CREDITS_HOLD_CLOSED");
    expect((await h.credits.balance(h.tx, a)).held).toBe(0);
    await h.credits.hold(h.tx, { accountId: a, amount: 3, idempotencyKey: "h-3" });
  });

  it(`${name}: a hold lapses by itself after its lifetime; settling for more than it held, or an unknown hold, is refused`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 5 });
    const hold = await h.credits.hold(h.tx, { accountId: a, amount: 5, ttlSeconds: 60, idempotencyKey: "h-1" });
    expect(await refusal(h.credits.settle(h.tx, hold.holdId, { amount: 6 }))).toBe("CREDITS_BAD_AMOUNT");
    expect((await h.credits.balance(h.tx, a)).held).toBe(5);
    h.setNow(plus(T0, 61));
    expect((await h.credits.balance(h.tx, a)).held).toBe(0);
    expect((await consume(h, a, 5)).draws).toHaveLength(1);
    expect(await refusal(h.credits.settle(h.tx, randomUUID()))).toBe("CREDITS_UNKNOWN_HOLD");
    expect(await refusal(h.credits.release(h.tx, randomUUID()))).toBe("CREDITS_UNKNOWN_HOLD");
  });

  it(`${name}: a hold settled for nothing spends nothing and is released`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 5 });
    const hold = await h.credits.hold(h.tx, { accountId: a, amount: 2, idempotencyKey: "h-0" });
    expect(await h.credits.settle(h.tx, hold.holdId, { amount: 0 })).toEqual({ draws: [], replayed: false });
    expect(await h.credits.balance(h.tx, a)).toMatchObject({ total: 5, held: 0 });
  });

  it(`${name}: a refund gives back to the same pots, once, whatever the number of calls`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const g = await grant(h, a, { amount: 5, onExhausted: ON_EXHAUSTED.fallbackPaid });
    await buy(h, a, 5);
    const spent = await consume(h, a, 7, "job-7");
    expect(spent.draws).toHaveLength(2);
    expect(await h.credits.refund(h.tx, { accountId: a, consumed: "job-7", reason: "the run failed" })).toEqual({
      refunded: 7,
      replayed: false,
    });
    expect(await h.credits.refund(h.tx, { accountId: a, consumed: "job-7", reason: "the run failed" })).toEqual({
      refunded: 7,
      replayed: true,
    });
    const b = await h.credits.balance(h.tx, a);
    expect(b.total).toBe(10);
    expect(b.grants.find((x) => x.id === g.grantId)?.remaining).toBe(5);
    expect(await refusal(h.credits.refund(h.tx, { accountId: a, consumed: "nope", reason: "x" }))).toBe(
      "CREDITS_NOTHING_TO_REFUND",
    );
    const other = await h.newAccount();
    expect(await refusal(h.credits.refund(h.tx, { accountId: other, consumed: "job-7", reason: "x" }))).toBe(
      "CREDITS_KEY_REUSED",
    );
  });

  it(`${name}: a refund of a settled hold, and a refund counts back against the cap`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 10, capPerDay: 2 });
    const hold = await h.credits.hold(h.tx, { accountId: a, amount: 2, idempotencyKey: "h-1" });
    await h.credits.settle(h.tx, hold.holdId);
    expect(await refusal(consume(h, a, 1))).toBe("CREDITS_CAP_DAY");
    await h.credits.refund(h.tx, { accountId: a, settledHold: hold.holdId, reason: "failed" });
    expect((await consume(h, a, 2)).draws).toHaveLength(1);
  });

  it(`${name}: an adjustment corrects a pot, never below zero, once per key`, async () => {
    const h = await make();
    const a = await h.newAccount();
    const g = await grant(h, a, { amount: 3 });
    expect(
      await h.credits.adjust(h.tx, {
        accountId: a,
        grantId: g.grantId,
        amount: 2,
        reason: "goodwill",
        idempotencyKey: "adj-1",
      }),
    ).toEqual({ replayed: false });
    expect(
      await h.credits.adjust(h.tx, {
        accountId: a,
        grantId: g.grantId,
        amount: 2,
        reason: "goodwill",
        idempotencyKey: "adj-1",
      }),
    ).toEqual({ replayed: true });
    expect((await h.credits.balance(h.tx, a)).total).toBe(5);
    expect(
      await refusal(
        h.credits.adjust(h.tx, {
          accountId: a,
          grantId: g.grantId,
          amount: -6,
          reason: "oops",
          idempotencyKey: "adj-2",
        }),
      ),
    ).toBe("CREDITS_BAD_AMOUNT");
    await h.credits.adjust(h.tx, {
      accountId: a,
      grantId: g.grantId,
      amount: -5,
      reason: "revoked",
      idempotencyKey: "adj-3",
    });
    expect((await h.credits.balance(h.tx, a)).total).toBe(0);
    expect(
      await refusal(
        h.credits.adjust(h.tx, {
          accountId: a,
          grantId: randomUUID(),
          amount: 1,
          reason: "x",
          idempotencyKey: "adj-4",
        }),
      ),
    ).toBe("CREDITS_UNKNOWN_GRANT");
  });

  it(`${name}: announces a grant, and a pot running out, once each`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 2, idempotencyKey: "g-1" });
    await grant(h, a, { amount: 2, idempotencyKey: "g-1" });
    await consume(h, a, 1);
    await consume(h, a, 1);
    const types = h.announced().map((m) => m.type);
    expect(types.filter((t) => t === "evt.credit.granted.v1")).toHaveLength(1);
    expect(types.filter((t) => t === "evt.credit.exhausted.v1")).toHaveLength(1);
    expect(h.announced().find((m) => m.type === "evt.credit.exhausted.v1")?.payload).toMatchObject({
      accountId: a,
      bucket: "granted",
      onExhausted: "stop",
      source: "coupon:test",
    });
  });

  it(`${name}: history pages back from a date`, async () => {
    const h = await make();
    const a = await h.newAccount();
    await grant(h, a, { amount: 9 });
    h.setNow(plus(T0, 60));
    await consume(h, a, 1);
    h.setNow(plus(T0, 120));
    await consume(h, a, 1);
    expect((await h.credits.history(h.tx, a, { limit: 2 })).map((l) => l.amount)).toEqual([-1, -1]);
    expect((await h.credits.history(h.tx, a, { before: plus(T0, 100) })).map((l) => l.amount)).toEqual([-1, 9]);
  });
}
