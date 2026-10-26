import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createOrazakaClient, isTerminal, ORAZAKA_CODE, OrazakaError, orazakaRefusal, outputOf, parseRun } from "../src";

/**
 * Contract tests against the edge's answers kept in `test/fixtures` (the shapes of orazaka-studio's `RunResponse`,
 * `RunArtefactResponse` and the installation list). When the edge changes a shape, a fixture changes here first.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
const RUN_ID = "6f1c2c1e-3a58-4b0e-9a47-0d3c0b9a1f10";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
type Reply = { status: number; body?: string; headers?: Record<string, string> } | Error;

/** A scripted edge: each call takes the next reply; what was asked is recorded. */
function edge(replies: Reply[]) {
  const seen: Seen[] = [];
  const queue = [...replies];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = queue.shift();
    if (!next) throw new Error("no scripted reply left");
    if (next instanceof Error) throw next;
    return new Response(next.body ?? null, { status: next.status, headers: next.headers });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

function clockAt(start: string) {
  let now = new Date(start);
  return { clock: { now: () => now }, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const make = (replies: Reply[], extra: Partial<Parameters<typeof createOrazakaClient>[0]> = {}) => {
  const e = edge(replies);
  const t = clockAt("2026-10-26T12:00:00Z");
  const client = createOrazakaClient({ baseUrl: "https://api.orazaka.test/", apiKey: "oz_test", clock: t.clock, fetch: e.fetch, ...extra });
  return { client, ...e, ...t };
};
const failure = async (promise: Promise<unknown>): Promise<OrazakaError> => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OrazakaError);
  return error as OrazakaError;
};

describe("starting a run", () => {
  it("installs the Studio once, then posts the inputs with the key as a bearer", async () => {
    const { client, seen } = make([{ status: 200, body: "[]" }, { status: 201, body: '{"studioKey":"compliance-check"}' }, { status: 202, body: fixture("run-accepted") }, { status: 202, body: fixture("run-accepted") }]);
    const { run, replayed } = await client.startRun("compliance-check", { document: "lease text" });
    expect(run).toMatchObject({ id: RUN_ID, studioKey: "compliance-check", status: "RUNNING", outputs: [] });
    expect(replayed).toBe(false);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET https://api.orazaka.test/api/v1/studios/installations",
      "POST https://api.orazaka.test/api/v1/studios/compliance-check/installations?locale=en",
      "POST https://api.orazaka.test/api/v1/studios/compliance-check/runs",
    ]);
    expect(seen[2]).toMatchObject({ headers: { authorization: "Bearer oz_test", "content-type": "application/json" }, body: { inputs: { document: "lease text" } } });
    await client.startRun("compliance-check", {}); // installed: no second install round
    expect(seen).toHaveLength(4);
  });

  it("does not install a Studio the account already has", async () => {
    const { client, seen } = make([{ status: 200, body: fixture("installations") }, { status: 202, body: fixture("run-accepted") }]);
    await client.startRun("compliance-check", {});
    expect(seen).toHaveLength(2);
  });

  it("can skip the installation round", async () => {
    const { client, seen } = make([{ status: 202, body: fixture("run-accepted") }], { autoInstall: false });
    await client.startRun("compliance-check", {});
    expect(seen).toHaveLength(1);
  });

  it("sends the idempotency key and says when the edge replayed the run", async () => {
    const { client, seen } = make([{ status: 202, body: fixture("run-accepted"), headers: { "idempotent-replayed": "true" } }], { autoInstall: false });
    const { replayed } = await client.startRun("compliance-check", { a: 1 }, { idempotencyKey: "doc-42-attempt-1" });
    expect(replayed).toBe(true);
    expect(seen[0]?.headers["idempotency-key"]).toBe("doc-42-attempt-1");
  });

  it("answers a key reused for another request with its own code", async () => {
    const { client } = make([{ status: 422, body: fixture("key-reused") }], { autoInstall: false });
    expect(await failure(client.startRun("compliance-check", {}, { idempotencyKey: "k" }))).toMatchObject({ code: ORAZAKA_CODE.keyReused, status: 409, details: { upstreamStatus: 422 } });
  });

  it("refuses what is not a Studio key or an idempotency key before any call", async () => {
    const { client, seen } = make([]);
    expect(await failure(client.startRun("../runs", {}))).toMatchObject({ code: ORAZAKA_CODE.input });
    expect(await failure(client.startRun("compliance-check", {}, { idempotencyKey: "has space" }))).toMatchObject({ code: ORAZAKA_CODE.input });
    expect(await failure(client.startRun("compliance-check", {}, { idempotencyKey: "x".repeat(256) }))).toMatchObject({ code: ORAZAKA_CODE.input });
    expect(seen).toEqual([]);
  });
});

describe("reading a run", () => {
  it("reads the status and the outputs", async () => {
    const { client, seen } = make([{ status: 200, body: fixture("run-succeeded") }]);
    const run = await client.getRun(RUN_ID);
    expect(seen[0]?.url).toBe(`https://api.orazaka.test/api/v1/studios/runs/${RUN_ID}`);
    expect(run.status).toBe("SUCCEEDED");
    expect(isTerminal(run)).toBe(true);
    expect(outputOf(run, "score")).toBe("92");
    expect(outputOf(run, "report")).toBe('{"findings":[]}');
    expect(outputOf(run, "missing")).toBeNull();
    expect(run.outputs[1]?.label).toBeNull();
  });

  it("refuses an id that is not a run id before any call", async () => {
    const { client, seen } = make([]);
    expect(await failure(client.getRun("../../admin"))).toMatchObject({ code: ORAZAKA_CODE.badRun, status: 400 });
    expect(seen).toEqual([]);
  });

  it("refuses an answer that is not a run", async () => {
    const { client } = make([{ status: 200, body: '{"hello":"world"}' }, { status: 200, body: "not json" }, { status: 200, body: '{"id":"a","studioKey":"s","status":"RUNNING","outputs":[{"key":1}]}' }]);
    for (let i = 0; i < 3; i += 1) expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.shape });
  });

  it("keeps a status it does not know", () => {
    expect(parseRun({ id: "a", studioKey: "s", status: "SOMETHING_NEW" })).toMatchObject({ status: "SOMETHING_NEW", outputs: [] });
    expect(isTerminal({ status: "SOMETHING_NEW" })).toBe(false);
  });
});

describe("waiting for a run", () => {
  it("reads until the run is over and gives back a failed run as it is", async () => {
    const { client, seen } = make([{ status: 200, body: fixture("run-accepted") }, { status: 200, body: fixture("run-accepted") }, { status: 200, body: fixture("run-failed") }], { sleep: async () => undefined });
    const run = await client.waitForRun(RUN_ID, { intervalMs: 10 });
    expect(run).toMatchObject({ status: "FAILED", errorMessage: "The document could not be read" });
    expect(seen).toHaveLength(3);
  });

  it("gives up when the time is over, by the injected clock", async () => {
    const t = clockAt("2026-10-26T12:00:00Z");
    const e = edge(Array.from({ length: 10 }, () => ({ status: 200, body: fixture("run-accepted") })));
    const client = createOrazakaClient({ baseUrl: "https://x", apiKey: "k", clock: t.clock, fetch: e.fetch, sleep: async (ms) => void t.advance(ms) });
    expect(await failure(client.waitForRun(RUN_ID, { intervalMs: 1000, timeoutMs: 3000 }))).toMatchObject({ code: ORAZAKA_CODE.waitExpired });
    expect(e.seen.length).toBeLessThanOrEqual(6);
  });
});

describe("what the edge refuses", () => {
  it.each([
    [401, ORAZAKA_CODE.key],
    [403, ORAZAKA_CODE.key],
    [402, ORAZAKA_CODE.credits],
    [409, ORAZAKA_CODE.locked],
    [400, ORAZAKA_CODE.input],
    [422, ORAZAKA_CODE.input],
    [404, ORAZAKA_CODE.notFound],
    [451, ORAZAKA_CODE.consent],
  ])("%i is %s", async (status, code) => {
    const { client } = make([{ status, body: "{}" }]);
    const error = await failure(client.getRun(RUN_ID));
    expect(error).toMatchObject({ code, details: { upstreamStatus: status } });
    expect(orazakaRefusal(status).code).toBe(code);
  });

  it("429 says when to come back, from the header first, bounded", async () => {
    const { client } = make([{ status: 429, body: fixture("busy") }, { status: 429, body: "{}", headers: { "retry-after": "5" } }, { status: 429, body: "{}", headers: { "retry-after": "9999" } }, { status: 429, body: "{}" }]);
    expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.busy, status: 429, retryAfterSeconds: 12 });
    expect((await failure(client.getRun(RUN_ID))).retryAfterSeconds).toBe(5);
    expect((await failure(client.getRun(RUN_ID))).retryAfterSeconds).toBe(300);
    expect((await failure(client.getRun(RUN_ID))).retryAfterSeconds).toBe(15);
  });

  it("no key, no call", async () => {
    const { client, seen } = make([], { apiKey: undefined });
    expect(await failure(client.studios())).toMatchObject({ code: ORAZAKA_CODE.notConfigured, status: 503 });
    expect(seen).toEqual([]);
  });
});

describe("when the edge is down", () => {
  const down = new TypeError("fetch failed");
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

  it("tells a timeout from no answer and from a 5xx", async () => {
    const { client } = make([timeout, down, { status: 503 }], { circuit: false });
    expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.timeout });
    expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.unavailable });
    expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.unavailable, details: { upstreamStatus: 503 } });
  });

  it("passes a time limit to every call", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch = (async (_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Response(fixture("run-accepted"));
    }) as unknown as typeof globalThis.fetch;
    await createOrazakaClient({ baseUrl: "https://x", apiKey: "k", clock: clockAt("2026-10-26T12:00:00Z").clock, fetch, timeoutMs: 1500 }).getRun(RUN_ID);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("opens the circuit after five failures in a row, refuses at once, probes after the pause", async () => {
    const replies: Reply[] = [down, down, down, down, down, { status: 200, body: fixture("run-succeeded") }];
    const { client, seen, advance } = make(replies);
    for (let i = 0; i < 5; i += 1) expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.unavailable });
    expect(client.circuit?.isOpen).toBe(true);
    const refused = await failure(client.getRun(RUN_ID));
    expect(refused).toMatchObject({ code: ORAZAKA_CODE.circuitOpen });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(seen).toHaveLength(5); // the sixth call never left
    advance(31_000);
    expect((await client.getRun(RUN_ID)).status).toBe("SUCCEEDED");
    expect(client.circuit?.isOpen).toBe(false);
  });

  it("a failed probe opens it again, and only one probe goes through", async () => {
    const { client, seen, advance } = make([down, down, down, down, down, down], { circuit: { failureThreshold: 5, openSeconds: 30 } });
    for (let i = 0; i < 5; i += 1) await failure(client.getRun(RUN_ID));
    advance(31_000);
    expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.unavailable });
    expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.circuitOpen });
    expect(seen).toHaveLength(6);
  });

  it("a refusal is an answer: it never opens the circuit", async () => {
    const { client } = make(Array.from({ length: 8 }, () => ({ status: 401 })));
    for (let i = 0; i < 8; i += 1) expect(await failure(client.getRun(RUN_ID))).toMatchObject({ code: ORAZAKA_CODE.key });
    expect(client.circuit?.isOpen).toBe(false);
  });

  it("a success in between resets the count", async () => {
    const { client } = make([down, down, down, down, { status: 200, body: fixture("run-accepted") }, down, down, down, down, { status: 200, body: fixture("run-accepted") }]);
    for (let i = 0; i < 4; i += 1) await failure(client.getRun(RUN_ID));
    await client.getRun(RUN_ID);
    for (let i = 0; i < 4; i += 1) await failure(client.getRun(RUN_ID));
    expect(client.circuit?.isOpen).toBe(false);
    await client.getRun(RUN_ID);
  });
});

describe("the Studios of the key", () => {
  it("lists them", async () => {
    const { client } = make([{ status: 200, body: fixture("installations") }]);
    expect(await client.studios()).toEqual(["compliance-check"]);
  });
});
