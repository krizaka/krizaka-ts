/** The stable codes of a refusal or a failure of Orazaka's edge — a product translates them; none is a sentence. */
export const ORAZAKA_CODE = {
  /** No API key was given. */
  notConfigured: "ORAZAKA_NOT_CONFIGURED",
  /** 401/403: the key is wrong, revoked or lacks the right. */
  key: "ORAZAKA_KEY",
  /** 402: the run is not affordable now. */
  credits: "ORAZAKA_CREDITS",
  /** 409: the Studio is locked (to buy, or already installed). */
  locked: "ORAZAKA_LOCKED",
  /** 400/422: the inputs are not what the Studio asks for. */
  input: "ORAZAKA_INPUT",
  /** 404: no such Studio or run (or not the caller's). */
  notFound: "ORAZAKA_NOT_FOUND",
  /** 429: too many runs at once; `retryAfterSeconds` says when to come back. Not a failure of the document. */
  busy: "ORAZAKA_BUSY",
  /** 422 `idempotency_key_reused`: the key already started a different request. */
  keyReused: "ORAZAKA_KEY_REUSED",
  /** 451: a consent is to be agreed to first. */
  consent: "ORAZAKA_CONSENT",
  /** The edge did not answer, or answered 5xx. */
  unavailable: "ORAZAKA_UNAVAILABLE",
  /** The edge did not answer within the time given. */
  timeout: "ORAZAKA_TIMEOUT",
  /** The edge answered something that is not a run (or a list of installations). */
  shape: "ORAZAKA_SHAPE",
  /** Too many failures in a row: the client does not call until the pause is over. */
  circuitOpen: "ORAZAKA_CIRCUIT_OPEN",
  /** A run id that is not one: refused before any call. */
  badRun: "ORAZAKA_BAD_RUN",
  /** `waitForRun` gave up: the run was still going. */
  waitExpired: "ORAZAKA_WAIT_EXPIRED",
} as const;
export type OrazakaCode = (typeof ORAZAKA_CODE)[keyof typeof ORAZAKA_CODE];

/** What the edge's status means for a product that answers its own caller: the status to send back and the code. */
export function orazakaRefusal(status: number): { status: number; code: OrazakaCode } {
  if (status === 401 || status === 403) return { status: 502, code: ORAZAKA_CODE.key };
  if (status === 402) return { status: 502, code: ORAZAKA_CODE.credits };
  if (status === 409) return { status: 502, code: ORAZAKA_CODE.locked };
  if (status === 400 || status === 422) return { status: 422, code: ORAZAKA_CODE.input };
  if (status === 404) return { status: 502, code: ORAZAKA_CODE.notFound };
  if (status === 429) return { status: 429, code: ORAZAKA_CODE.busy };
  if (status === 451) return { status: 502, code: ORAZAKA_CODE.consent };
  return { status: 502, code: ORAZAKA_CODE.unavailable };
}

export class OrazakaError extends Error {
  constructor(
    readonly code: OrazakaCode,
    message: string,
    readonly details: {
      /** What the edge answered, when it answered. */
      upstreamStatus?: number;
      /** The status a product should answer its own caller with. */
      status?: number;
      /** For `ORAZAKA_BUSY` and `ORAZAKA_CIRCUIT_OPEN`: seconds to wait. */
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "OrazakaError";
  }

  /** The HTTP status a product answers its own caller with (502 for a failure upstream, 429 when busy). */
  get status(): number {
    return this.details.status ?? 502;
  }

  get retryAfterSeconds(): number | undefined {
    return this.details.retryAfterSeconds;
  }
}
