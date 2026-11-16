import { describe, expect, it } from "vitest";

import { backoffMs, createRetryBudget, parseRetryAfter, retrying } from "../src";

const clockAt = (start: number) => {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
};
const recorder = () => {
  const waits: number[] = [];
  return { waits, sleep: (ms: number) => Promise.resolve().then(() => void waits.push(ms)) };
};
const failing = (failures: number, error: unknown = new Error("down")) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: () => {
      calls += 1;
      return calls <= failures ? Promise.reject(error as Error) : Promise.resolve("ok");
    },
  };
};

describe("backoffMs (full jitter)", () => {
  it("stays within [0, min(cap, base × 2^(n-1))]", () => {
    expect(backoffMs(1, 100, 10_000, () => 0.999999)).toBeLessThanOrEqual(100);
    expect(backoffMs(3, 100, 10_000, () => 0.999999)).toBeLessThanOrEqual(400);
    expect(backoffMs(20, 100, 1000, () => 0.999999)).toBeLessThanOrEqual(1000);
    expect(backoffMs(2, 100, 10_000, () => 0)).toBe(0);
    for (let i = 0; i < 200; i++) expect(backoffMs(10, 100, 1000, Math.random)).toBeLessThan(1000);
  });
});

describe("retrying", () => {
  it("retries a retryable failure, waiting the jittered backoff", async () => {
    const { waits, sleep } = recorder();
    const op = failing(2);
    const out = await retrying(op.run, { isRetryable: () => true, random: () => 0.5, sleep });
    expect(out).toBe("ok");
    expect(op.calls).toBe(3);
    expect(waits).toEqual([50, 100]);
  });

  it("never retries a non-retryable answer", async () => {
    const { waits, sleep } = recorder();
    const op = failing(5, new Error("401"));
    await expect(retrying(op.run, { isRetryable: () => false, sleep })).rejects.toThrow("401");
    expect(op.calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const { sleep } = recorder();
    const op = failing(10);
    await expect(retrying(op.run, { isRetryable: () => true, maxAttempts: 4, sleep })).rejects.toThrow("down");
    expect(op.calls).toBe(4);
  });

  it("waits at least the server's Retry-After", async () => {
    const { waits, sleep } = recorder();
    const op = failing(1, Object.assign(new Error("busy"), { after: 7000 }));
    await retrying(op.run, {
      isRetryable: () => true,
      retryAfterMs: (e) => (e as { after?: number }).after,
      random: () => 0.5,
      sleep,
    });
    expect(waits).toEqual([7000]);
  });

  it("the budget stops the retries", async () => {
    const clock = clockAt(0);
    const budget = createRetryBudget({ capacity: 1, refillPerSecond: 0 }, clock);
    const { sleep } = recorder();
    const op = failing(10);
    await expect(retrying(op.run, { isRetryable: () => true, maxAttempts: 5, budget, sleep })).rejects.toThrow("down");
    expect(op.calls).toBe(2); // one retry paid for, the second refused
  });
});

describe("createRetryBudget", () => {
  it("refills over time up to its capacity", () => {
    const clock = clockAt(0);
    const budget = createRetryBudget({ capacity: 2, refillPerSecond: 1 }, clock);
    expect([budget.tryTake(), budget.tryTake(), budget.tryTake()]).toEqual([true, true, false]);
    clock.advance(1000);
    expect(budget.tryTake()).toBe(true);
    expect(budget.tryTake()).toBe(false);
    clock.advance(60_000);
    expect([budget.tryTake(), budget.tryTake(), budget.tryTake()]).toEqual([true, true, false]);
  });
});

describe("parseRetryAfter", () => {
  const clock = clockAt(Date.parse("2026-11-16T10:00:00Z"));
  it("reads seconds and HTTP dates, ignores the rest", () => {
    expect(parseRetryAfter("12", clock)).toBe(12_000);
    expect(parseRetryAfter("Mon, 16 Nov 2026 10:00:30 GMT", clock)).toBe(30_000);
    expect(parseRetryAfter("Mon, 16 Nov 2026 09:00:00 GMT", clock)).toBe(0);
    expect(parseRetryAfter("soon", clock)).toBeUndefined();
    expect(parseRetryAfter(null, clock)).toBeUndefined();
    expect(parseRetryAfter(" ", clock)).toBeUndefined();
  });
});
