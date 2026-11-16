/** Arms a timer, returns how to cancel it. Injected so tests drive time; the default is `setTimeout` (unref'd). */
export type Timer = (milliseconds: number, onFire: () => void) => () => void;

export const systemTimer: Timer = (milliseconds, onFire) => {
  const handle = setTimeout(onFire, milliseconds);
  handle.unref();
  return () => clearTimeout(handle);
};

export type TimeoutPhase = "first-byte" | "whole";

export class TimeoutError extends Error {
  constructor(
    readonly phase: TimeoutPhase,
    readonly limitMs: number,
  ) {
    super(phase === "first-byte" ? `No first byte within ${limitMs} ms` : `No answer within ${limitMs} ms`);
    this.name = "TimeoutError";
  }
}

export interface TimeoutOptions {
  /** The whole call, in milliseconds. */
  wholeMs: number;
  /** Connect / first byte: the call must report `firstByte()` within this, in milliseconds. Unset: no such limit. */
  firstByteMs?: number;
  timer?: Timer;
}

export interface TimedCall {
  /** Aborted on a timeout: hand it to `fetch`. */
  signal: AbortSignal;
  /** Call it when the first byte (the response headers) arrived. */
  firstByte(): void;
}

/** Runs `run` under a whole-call limit and an optional first-byte limit; either one aborts the signal and rejects with `TimeoutError`. */
export function withTimeout<T>(run: (call: TimedCall) => Promise<T>, options: TimeoutOptions): Promise<T> {
  const timer = options.timer ?? systemTimer;
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let cancelFirst = (): void => undefined;
    let cancelWhole = (): void => undefined;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      cancelFirst();
      cancelWhole();
      finish();
    };
    const expire = (phase: TimeoutPhase, limitMs: number): void =>
      settle(() => {
        const error = new TimeoutError(phase, limitMs);
        controller.abort(error);
        reject(error);
      });
    cancelWhole = timer(options.wholeMs, () => expire("whole", options.wholeMs));
    if (options.firstByteMs !== undefined) {
      const limit = options.firstByteMs;
      cancelFirst = timer(limit, () => expire("first-byte", limit));
    }
    run({ signal: controller.signal, firstByte: () => cancelFirst() }).then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
