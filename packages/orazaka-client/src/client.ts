import { addMilliseconds, isAfter } from "date-fns";

import { type Circuit, type CircuitOptions, type Clock, createCircuit } from "./circuit";
import { ORAZAKA_CODE, OrazakaError, orazakaRefusal } from "./errors";
import { isTerminal, type OrazakaRun, parseInstallations, parseRun } from "./run";

type Fetch = typeof fetch;

export interface OrazakaClientOptions {
  /** `https://api.orazaka.com` — the edge. A parameter: this package reads no environment. */
  baseUrl: string;
  /** The product's service key (`oz_…`). Without one every call throws `ORAZAKA_NOT_CONFIGURED`. */
  apiKey: string | undefined;
  /** Time is injected: the circuit and `waitForRun` read it from here. */
  clock: Clock;
  fetch?: Fetch;
  /** One call's time limit, in milliseconds (default 20 000). */
  timeoutMs?: number;
  /** The breaker: `false` for none; default 5 failures in a row open it for 30 seconds. */
  circuit?: CircuitOptions | false;
  /** Install the Studio on the account before its first run (default true: the edge asks for it). */
  autoInstall?: boolean;
  /** How `waitForRun` waits between two reads (default `setTimeout`); tests give their own. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface StartRunOptions {
  /** Retrying with the same key (and the same inputs) answers the run already started instead of paying for a second one. */
  idempotencyKey?: string;
}

export interface StartedRun {
  run: OrazakaRun;
  /** The edge answered a run it had already started for this key (`Idempotent-Replayed`). */
  replayed: boolean;
}

export interface WaitOptions {
  /** Between two reads, in milliseconds (default 2 000). */
  intervalMs?: number;
  /** Give up after this long, in milliseconds (default 120 000): `ORAZAKA_WAIT_EXPIRED`. */
  timeoutMs?: number;
}

export interface OrazakaClient {
  /** Starts a Studio run (`POST /api/v1/studios/{studio}/runs`, 202). Pass an idempotency key to make the retry safe. */
  startRun(studio: string, inputs: Record<string, unknown>, options?: StartRunOptions): Promise<StartedRun>;
  /** The run, its status and its outputs (`GET /api/v1/studios/runs/{id}`). */
  getRun(runId: string): Promise<OrazakaRun>;
  /** Reads the run until it is over (succeeded, failed or cancelled) and answers it; a failed run is returned, not thrown. */
  waitForRun(runId: string, options?: WaitOptions): Promise<OrazakaRun>;
  /** The Studios this key has installed — also the cheapest call that proves the key and the connection. */
  studios(): Promise<string[]>;
  /** The circuit breaker, for diagnostics. */
  readonly circuit: Circuit | null;
}

const STUDIO_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/i;
const RUN_ID = /^[0-9a-f-]{36}$/i;
const IDEMPOTENCY_KEY = /^[!-~]{1,255}$/;
/** The stable code the edge answers (HTTP 422) when an idempotency key already started a different request. */
const KEY_REUSED = "idempotency_key_reused";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CIRCUIT: CircuitOptions = { failureThreshold: 5, openSeconds: 30 };
const DEFAULT_WAIT_INTERVAL_MS = 2000;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const BUSY_MIN_SECONDS = 1;
const BUSY_MAX_SECONDS = 300;
const BUSY_DEFAULT_SECONDS = 15;

/** Never served from a framework's fetch cache: a run's status changes. (`cache` is a runtime option the Node typings do not list.) */
const NO_STORE = { cache: "no-store" } as RequestInit;

const sleepFor = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

interface Call {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
}

/** Orazaka's edge, for every TypeScript product: one client instead of one copy per product. */
export function createOrazakaClient(options: OrazakaClientOptions): OrazakaClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const circuit = options.circuit === false ? null : createCircuit(options.circuit ?? DEFAULT_CIRCUIT, options.clock);
  const sleep = options.sleep ?? sleepFor;
  const installed = new Set<string>();

  /** The edge answered with a refusal: a stable error. A refusal is an answer, so the circuit stays closed. */
  async function refusal(res: Response, method: string, path: string): Promise<OrazakaError> {
    const where = `${method} ${path.split("?")[0]}`;
    const body = (await res.json().catch(() => null)) as { status?: unknown; code?: unknown; retryAfterSeconds?: unknown } | null;
    if (res.status === 429) {
      const asked = Number(res.headers.get("retry-after") ?? body?.retryAfterSeconds);
      const wait = Math.min(BUSY_MAX_SECONDS, Math.max(BUSY_MIN_SECONDS, asked || BUSY_DEFAULT_SECONDS));
      return new OrazakaError(ORAZAKA_CODE.busy, `Orazaka is busy on ${where}`, { upstreamStatus: 429, status: 429, retryAfterSeconds: wait });
    }
    if (res.status === 422 && (body?.status === KEY_REUSED || body?.code === KEY_REUSED)) {
      return new OrazakaError(ORAZAKA_CODE.keyReused, `The idempotency key already started a different request on ${where}`, { upstreamStatus: 422, status: 409 });
    }
    const { status, code } = orazakaRefusal(res.status);
    return new OrazakaError(code, `Orazaka answered ${res.status} on ${where}`, { upstreamStatus: res.status, status });
  }

  async function call(path: string, init: Call = {}): Promise<Response> {
    if (!options.apiKey) throw new OrazakaError(ORAZAKA_CODE.notConfigured, "The Orazaka API key is not set", { status: 503 });
    circuit?.check();
    const method = init.method ?? "GET";
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
        ...NO_STORE,
      });
    } catch (cause) {
      circuit?.failure();
      const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      throw new OrazakaError(timedOut ? ORAZAKA_CODE.timeout : ORAZAKA_CODE.unavailable, timedOut ? "Orazaka did not answer in time" : "Orazaka did not answer", { status: 502 });
    }
    if (res.status >= 500) {
      circuit?.failure();
      throw new OrazakaError(ORAZAKA_CODE.unavailable, `Orazaka answered ${res.status} on ${method} ${path.split("?")[0]}`, { upstreamStatus: res.status, status: 502 });
    }
    circuit?.success();
    if (!res.ok) throw await refusal(res, method, path);
    return res;
  }

  const json = (res: Response): Promise<unknown> => res.json().catch(() => undefined);

  async function studios(): Promise<string[]> {
    return parseInstallations(await json(await call("/api/v1/studios/installations")));
  }

  async function ensureInstalled(studio: string): Promise<void> {
    if (installed.has(studio)) return;
    if (!(await studios()).includes(studio)) await call(`/api/v1/studios/${studio}/installations?locale=en`, { method: "POST", body: { config: {} } });
    installed.add(studio);
  }

  const checkRunId = (runId: string) => {
    if (!RUN_ID.test(runId)) throw new OrazakaError(ORAZAKA_CODE.badRun, "Not a run id", { status: 400 });
  };

  async function getRun(runId: string): Promise<OrazakaRun> {
    checkRunId(runId);
    return parseRun(await json(await call(`/api/v1/studios/runs/${runId}`)));
  }

  return {
    circuit,
    studios,
    getRun,
    async startRun(studio, inputs, { idempotencyKey } = {}) {
      if (!STUDIO_KEY.test(studio)) throw new OrazakaError(ORAZAKA_CODE.input, "Not a Studio key", { status: 422 });
      if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) throw new OrazakaError(ORAZAKA_CODE.input, "An idempotency key is 1 to 255 printable characters", { status: 422 });
      if (options.autoInstall !== false) await ensureInstalled(studio);
      const res = await call(`/api/v1/studios/${studio}/runs`, { method: "POST", body: { inputs }, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {} });
      return { run: parseRun(await json(res)), replayed: res.headers.get("idempotent-replayed") === "true" };
    },
    async waitForRun(runId, { intervalMs = DEFAULT_WAIT_INTERVAL_MS, timeoutMs: waitMs = DEFAULT_WAIT_TIMEOUT_MS } = {}) {
      const deadline = addMilliseconds(options.clock.now(), waitMs);
      for (;;) {
        const run = await getRun(runId);
        if (isTerminal(run)) return run;
        if (isAfter(options.clock.now(), deadline)) throw new OrazakaError(ORAZAKA_CODE.waitExpired, `The run is still ${run.status} after ${waitMs} ms`, { status: 504 });
        await sleep(intervalMs);
      }
    },
  };
}
