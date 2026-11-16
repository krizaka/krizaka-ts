# @krizaka/resilience

One timeout, one jittered retry and one circuit breaker for every product client, lifted from `@krizaka/sovkora-client` so the next client (Kridoc, …) does not copy it. Clock, sleep, timer and random are **parameters**: no environment, no vendor SDK, no ambient clock.

```ts
import { createCircuit, createRetryBudget, parseRetryAfter, retrying, withTimeout } from "@krizaka/resilience";

const clock = { now: () => new Date() };
const circuit = createCircuit({ failureThreshold: 5, openSeconds: 30 }, clock);
const budget = createRetryBudget({ capacity: 10, refillPerSecond: 1 }, clock);

const res = await retrying(
  () => {
    circuit.check();
    return withTimeout(({ signal, firstByte }) => fetch(url, { signal }).then((r) => (firstByte(), r)), {
      wholeMs: 20_000,
      firstByteMs: 5000,
    });
  },
  {
    isRetryable: (e) => e instanceof TypeError, // only what is safe to repeat
    retryAfterMs: (e) => /* parseRetryAfter(header, clock) */ undefined,
    budget,
  },
);
```

- `withTimeout(run, { wholeMs, firstByteMs? })`: aborts the signal and rejects with `TimeoutError` (`phase`: `whole` or `first-byte`).
- `retrying(operation, options)`: full-jitter exponential backoff (`baseMs`, `capMs`), at least the server's `Retry-After` (`parseRetryAfter`, RFC 9110), an `isRetryable` predicate (a non-retryable answer is never retried) and a `createRetryBudget` token bucket. The last error is rethrown as it was.
- `createCircuit(options, clock, { refuse? })`: N failures in a row open it; after `openSeconds` one probe is let through; a refusal of the edge is an answer, not a failure (the caller reports failures only). `check()` throws `CircuitOpenError`, or the client's own error from `refuse`.

Sources: AWS « Exponential backoff and jitter », AWS Builders' Library « Making retries safe with idempotent APIs », Azure « Circuit Breaker pattern ».
