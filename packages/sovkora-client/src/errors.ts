/** The stable codes of a refusal or a failure of Sovkora's edge — a product translates them; none is a sentence. */
export const SOVKORA_CODE = {
  /** No API key was given. */
  notConfigured: "SOVKORA_NOT_CONFIGURED",
  /** 401/403: the key is wrong, revoked or lacks the right. */
  key: "SOVKORA_KEY",
  /** 402: the run is not affordable now. */
  credits: "SOVKORA_CREDITS",
  /** 409: the Studio is locked (to buy, or already installed). */
  locked: "SOVKORA_LOCKED",
  /** 400/422: the inputs are not what the Studio asks for. */
  input: "SOVKORA_INPUT",
  /** 404: no such Studio or run (or not the caller's). */
  notFound: "SOVKORA_NOT_FOUND",
  /** 429: too many runs at once; `retryAfterSeconds` says when to come back. Not a failure of the document. */
  busy: "SOVKORA_BUSY",
  /** 422 `idempotency_key_reused`: the key already started a different request. */
  keyReused: "SOVKORA_KEY_REUSED",
  /** 451: a consent is to be agreed to first. */
  consent: "SOVKORA_CONSENT",
  /** The edge did not answer, or answered 5xx. */
  unavailable: "SOVKORA_UNAVAILABLE",
  /** The edge did not answer within the time given. */
  timeout: "SOVKORA_TIMEOUT",
  /** The edge answered something that is not a run (or a list of installations). */
  shape: "SOVKORA_SHAPE",
  /** Too many failures in a row: the client does not call until the pause is over. */
  circuitOpen: "SOVKORA_CIRCUIT_OPEN",
  /** A run id that is not one: refused before any call. */
  badRun: "SOVKORA_BAD_RUN",
  /** `waitForRun` gave up: the run was still going. */
  waitExpired: "SOVKORA_WAIT_EXPIRED",
} as const;
export type SovkoraCode = (typeof SOVKORA_CODE)[keyof typeof SOVKORA_CODE];

/** What the edge's status means for a product that answers its own caller: the status to send back and the code. */
export function sovkoraRefusal(status: number): { status: number; code: SovkoraCode } {
  if (status === 401 || status === 403) return { status: 502, code: SOVKORA_CODE.key };
  if (status === 402) return { status: 502, code: SOVKORA_CODE.credits };
  if (status === 409) return { status: 502, code: SOVKORA_CODE.locked };
  if (status === 400 || status === 422) return { status: 422, code: SOVKORA_CODE.input };
  if (status === 404) return { status: 502, code: SOVKORA_CODE.notFound };
  if (status === 429) return { status: 429, code: SOVKORA_CODE.busy };
  if (status === 451) return { status: 502, code: SOVKORA_CODE.consent };
  return { status: 502, code: SOVKORA_CODE.unavailable };
}

export class SovkoraError extends Error {
  constructor(
    readonly code: SovkoraCode,
    message: string,
    readonly details: {
      /** What the edge answered, when it answered. */
      upstreamStatus?: number;
      /** The status a product should answer its own caller with. */
      status?: number;
      /** For `SOVKORA_BUSY` and `SOVKORA_CIRCUIT_OPEN`: seconds to wait. */
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "SovkoraError";
  }

  /** The HTTP status a product answers its own caller with (502 for a failure upstream, 429 when busy). */
  get status(): number {
    return this.details.status ?? 502;
  }

  get retryAfterSeconds(): number | undefined {
    return this.details.retryAfterSeconds;
  }
}
