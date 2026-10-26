import { ORAZAKA_CODE, OrazakaError } from "./errors";

/** One output of a run (orazaka-studio `RunArtefactResponse`): `type` is a rendering hint (`TEXT`, `IMAGE`, `VIDEO`…). */
export interface RunOutput {
  key: string;
  label: string | null;
  type: string;
  value: string | null;
}

/** Where a run sits (orazaka-studio `RunStatus`). The client keeps the string the edge sent, so a new status is not a failure. */
export const RUN_STATUS = {
  pendingApproval: "PENDING_APPROVAL",
  running: "RUNNING",
  awaitingInput: "AWAITING_INPUT",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  cancelled: "CANCELLED",
  compensating: "COMPENSATING",
} as const;

const TERMINAL: readonly string[] = [RUN_STATUS.succeeded, RUN_STATUS.failed, RUN_STATUS.cancelled];

/** A run, as the edge answers it (`GET /api/v1/studios/runs/{id}`). Only what a product reads. */
export interface OrazakaRun {
  id: string;
  studioKey: string;
  blueprintVersion: string | null;
  status: string;
  outputs: RunOutput[];
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** The run is over, green or not: nothing more will change. */
export const isTerminal = (run: Pick<OrazakaRun, "status">): boolean => TERMINAL.includes(run.status);

/** The value of one output, or null when the run did not produce it (yet). */
export const outputOf = (run: Pick<OrazakaRun, "outputs">, key: string): string | null => run.outputs.find((o) => o.key === key)?.value ?? null;

const shape = (what: string) => new OrazakaError(ORAZAKA_CODE.shape, `Orazaka's answer has an unexpected shape: ${what}`);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

const parseOutput = (raw: unknown): RunOutput => {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.key !== "string" || typeof o.type !== "string") throw shape("an output without key and type");
  return { key: o.key, label: text(o.label), type: o.type, value: text(o.value) };
};

/** Reads a run from the edge's JSON; anything else is `ORAZAKA_SHAPE`. */
export function parseRun(body: unknown): OrazakaRun {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.studioKey !== "string" || typeof o.status !== "string") throw shape("a run needs id, studioKey and status");
  if (o.outputs !== undefined && o.outputs !== null && !Array.isArray(o.outputs)) throw shape("outputs is not a list");
  return {
    id: o.id,
    studioKey: o.studioKey,
    blueprintVersion: text(o.blueprintVersion),
    status: o.status,
    outputs: ((o.outputs as unknown[] | null | undefined) ?? []).map(parseOutput),
    errorMessage: text(o.errorMessage),
    startedAt: text(o.startedAt),
    finishedAt: text(o.finishedAt),
  };
}

/** The Studios an account installed: `GET /api/v1/studios/installations`. */
export function parseInstallations(body: unknown): string[] {
  if (!Array.isArray(body)) throw shape("installations is not a list");
  return body.map((i) => {
    const key = (i as Record<string, unknown> | null)?.studioKey;
    if (typeof key !== "string") throw shape("an installation without studioKey");
    return key;
  });
}
