/**
 * One recommendation of a brief: a fact, its figures, and the one action that follows. Money is integer cents; the
 * words are the product's (messages keyed by `kind` and the figure names), never stored here.
 */

/** How soon the owner should act; the ranking reads this before the impact. */
export const URGENCY = { now: 0, week: 1, info: 2 } as const;
export type Urgency = keyof typeof URGENCY;

/** What the button does: the product executes it (its kind and its payload are its own). */
export interface BriefAction<Kind extends string = string, Payload = unknown> {
  readonly kind: Kind;
  readonly payload: Payload;
}

export interface Recommendation<Kind extends string = string, Action extends BriefAction = BriefAction> {
  /** Stable across re-computations of the same week: `<week>:<kind>:<subject>` (an action is idempotent on it). */
  readonly id: string;
  readonly kind: Kind;
  /** What it is about (a service id, a day, « shop »). */
  readonly subject: string;
  readonly urgency: Urgency;
  /** What acting is worth, or what not acting costs, in integer cents (≥ 0). */
  readonly impactCents: number;
  /** Named integers the card shows (cents or counts). */
  readonly figures: Readonly<Record<string, number>>;
  /** Keys of the assumptions the card writes under the figure (« at equal volume »). */
  readonly assumptions: readonly string[];
  /** Ids of the rows it was computed from — the proof. */
  readonly evidence: readonly string[];
  readonly action: Action;
}

export class BriefError extends Error {
  constructor(
    readonly code: "NOT_INTEGER" | "NEGATIVE_IMPACT" | "BAD_SUBJECT",
    message: string,
  ) {
    super(message);
    this.name = "BriefError";
  }
}

export type RecommendationInput<Kind extends string, Action extends BriefAction> = Omit<
  Recommendation<Kind, Action>,
  "id" | "assumptions" | "evidence"
> & {
  readonly week: string;
  readonly assumptions?: readonly string[];
  readonly evidence?: readonly string[];
};

/** Builds a recommendation, checks its money and figures are integers, and gives it its stable id. */
export function recommendation<Kind extends string, Action extends BriefAction>(
  input: RecommendationInput<Kind, Action>,
): Recommendation<Kind, Action> {
  const { week, assumptions = [], evidence = [], ...rest } = input;
  if (rest.subject.length === 0 || rest.subject.includes(":"))
    throw new BriefError("BAD_SUBJECT", `subject « ${rest.subject} » must be non-empty, without « : »`);
  if (!Number.isSafeInteger(rest.impactCents))
    throw new BriefError("NOT_INTEGER", `${rest.kind}: impactCents must be an integer`);
  if (rest.impactCents < 0) throw new BriefError("NEGATIVE_IMPACT", `${rest.kind}: impactCents must be ≥ 0`);
  for (const [name, value] of Object.entries(rest.figures)) {
    if (!Number.isSafeInteger(value))
      throw new BriefError("NOT_INTEGER", `${rest.kind}: figure ${name} must be an integer`);
  }
  return { id: `${week}:${rest.kind}:${rest.subject}`, ...rest, assumptions, evidence };
}
