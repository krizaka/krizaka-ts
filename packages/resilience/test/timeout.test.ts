import { describe, expect, it } from "vitest";

import { systemTimer, TimeoutError, type Timer, withTimeout } from "../src";

/** A timer the test fires by hand. */
const manualTimers = () => {
  const armed: { ms: number; fire: () => void; live: boolean }[] = [];
  const timer: Timer = (ms, fire) => {
    const entry = { ms, fire, live: true };
    armed.push(entry);
    return () => void (entry.live = false);
  };
  return { armed, timer, fire: (ms: number) => armed.find((t) => t.ms === ms && t.live)?.fire() };
};
const never = () => new Promise<never>(() => undefined);

describe("withTimeout", () => {
  it("answers and cancels its timers when the call is quick", async () => {
    const { armed, timer } = manualTimers();
    await expect(withTimeout(() => Promise.resolve(42), { wholeMs: 1000, firstByteMs: 100, timer })).resolves.toBe(42);
    expect(armed.every((t) => !t.live)).toBe(true);
  });

  it("rejects with TimeoutError(whole) and aborts the signal", async () => {
    const t = manualTimers();
    let signal: AbortSignal | undefined;
    const p = withTimeout(
      (call) => {
        signal = call.signal;
        return never();
      },
      { wholeMs: 1000, timer: t.timer },
    );
    t.fire(1000);
    await expect(p).rejects.toMatchObject({ name: "TimeoutError", phase: "whole", limitMs: 1000 });
    expect(signal?.aborted).toBe(true);
  });

  it("rejects on no first byte, but not once firstByte() was called", async () => {
    const t = manualTimers();
    const slow = withTimeout(() => never(), { wholeMs: 1000, firstByteMs: 100, timer: t.timer });
    t.fire(100);
    await expect(slow).rejects.toBeInstanceOf(TimeoutError);
    await expect(slow).rejects.toMatchObject({ phase: "first-byte" });

    const t2 = manualTimers();
    const ok = withTimeout(
      (call) => {
        call.firstByte();
        return new Promise<string>((resolve) => setTimeout(() => resolve("late"), 0));
      },
      { wholeMs: 1000, firstByteMs: 100, timer: t2.timer },
    );
    t2.fire(100); // cancelled: does nothing
    await expect(ok).resolves.toBe("late");
  });

  it("passes the call's own error through", async () => {
    await expect(withTimeout(() => Promise.reject(new Error("boom")), { wholeMs: 1000 })).rejects.toThrow("boom");
  });

  it("the system timer fires and cancels", async () => {
    let fired = 0;
    systemTimer(1, () => fired++);
    systemTimer(1, () => fired++)();
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(1);
    await expect(withTimeout(() => never(), { wholeMs: 5 })).rejects.toBeInstanceOf(TimeoutError);
  });
});
