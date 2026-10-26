# @krizaka/orazaka-client

One client of Orazaka's edge for every Krizaka TypeScript product, instead of one copy per product (Yomizaka, Orochia, soon Akinaza): start a Studio run, read its status and its outputs, wait for it. The base URL, the key and the clock are **parameters** — this package reads no environment and no wall clock.

```ts
import { createOrazakaClient, outputOf } from "@krizaka/orazaka-client";

const orazaka = createOrazakaClient({ baseUrl: "https://api.orazaka.com", apiKey: env.AI_API_KEY, clock: { now: () => new Date() } });

const { run } = await orazaka.startRun("compliance-check", { document: text }, { idempotencyKey: `doc-${documentId}-v${version}` });
const done = await orazaka.waitForRun(run.id); // or poll `getRun` yourself
if (done.status === "SUCCEEDED") use(outputOf(done, "report"));
```

- **Safe to retry.** `startRun` with an `idempotencyKey` answers the run already started for the same key and inputs (`replayed: true`) instead of paying for a second one; the same key for other inputs is `ORAZAKA_KEY_REUSED`.
- **Typed errors.** Every failure is an `OrazakaError` with a stable `code` (`ORAZAKA_KEY`, `ORAZAKA_CREDITS`, `ORAZAKA_LOCKED`, `ORAZAKA_INPUT`, `ORAZAKA_NOT_FOUND`, `ORAZAKA_BUSY` with `retryAfterSeconds`, `ORAZAKA_UNAVAILABLE`, `ORAZAKA_TIMEOUT`, `ORAZAKA_SHAPE`, `ORAZAKA_CIRCUIT_OPEN`…) and the `status` a product answers its own caller with. A product translates the codes; none is a sentence. A failed *run* is not an error: `waitForRun` gives it back with its `errorMessage`.
- **A time limit and a circuit breaker**, as options: `timeoutMs` (20 s by default) on every call; five failures in a row (no answer, timeout, 5xx) open the circuit for 30 s — it refuses at once, then lets one call probe. A refusal (401, 402, 404, 429…) is an answer and never opens it. `circuit: false` turns it off.
- **Contract-tested** against the edge's answers kept as fixtures (`test/fixtures`): when the edge changes a shape, the fixture changes first.

Run events as a stream (Server-Sent Events, `GET /api/v1/studios/runs/{id}/events`) come in a later minor; `waitForRun` polls until then.
