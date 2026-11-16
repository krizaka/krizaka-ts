import { addSeconds, differenceInMilliseconds, isBefore } from "@krizaka/time";

export interface Clock {
  now(): Date;
}

export interface CircuitOptions {
  /** Consecutive failures (no answer, timeout, 5xx) that open the circuit. */
  failureThreshold: number;
  /** How long it stays open before one call is let through to probe. */
  openSeconds: number;
}

/** Thrown by `check()` while the circuit refuses; a client may give its own error with `refuse`. */
export class CircuitOpenError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("The dependency failed several times in a row: not calling it for a moment");
    this.name = "CircuitOpenError";
  }
}

export interface CircuitHooks {
  /** The error `check()` throws while open; default `CircuitOpenError`. */
  refuse?: (retryAfterSeconds: number) => Error;
}

/**
 * A circuit breaker over a dependency that may be down: after `failureThreshold` failures in a row it refuses at once (no waiting on
 * a timeout, no load on a struggling service) for `openSeconds`, then lets ONE call through; its success closes the circuit, its
 * failure opens it again. A refusal of the edge (401, 402, 404…) is an answer, not a failure: only the caller reports failures.
 */
export function createCircuit(options: CircuitOptions, clock: Clock, hooks: CircuitHooks = {}) {
  const refuse = hooks.refuse ?? ((seconds: number) => new CircuitOpenError(seconds));
  let failures = 0;
  let openUntil: Date | null = null;
  let probing = false;
  return {
    /** Throws while the circuit is open (or its probe is in flight). */
    check(): void {
      if (openUntil === null) return;
      const now = clock.now();
      if (isBefore(now, openUntil))
        throw refuse(Math.max(1, Math.floor(differenceInMilliseconds(openUntil, now) / 1000)));
      if (probing) throw refuse(1);
      probing = true;
    },
    success(): void {
      failures = 0;
      openUntil = null;
      probing = false;
    },
    failure(): void {
      failures += 1;
      if (probing || failures >= options.failureThreshold) {
        openUntil = addSeconds(clock.now(), options.openSeconds);
        probing = false;
      }
    },
    /** Test and diagnostics: is it refusing now? */
    get isOpen(): boolean {
      return openUntil !== null;
    },
  };
}

export type Circuit = ReturnType<typeof createCircuit>;
