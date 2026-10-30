import { ORAZAKA_CODE, OrazakaError } from "./errors";

/** The checks a product may ask for: `POST /api/v1/checks/{purpose}`. Identity checks are not offered to products. */
export const CHECK_PURPOSE = { courtRecords: "court-records", credit: "credit" } as const;
export type CheckPurposeKey = (typeof CHECK_PURPOSE)[keyof typeof CHECK_PURPOSE];

export const CHECK_OUTCOME = ["MATCH", "NO_MATCH", "PENDING", "PROVIDER_ERROR", "TIMEOUT", "REFUSED"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOME)[number];

/** Why a check was refused; present exactly when the outcome is `REFUSED`. `NOT_CONFIGURED` means Orazaka has no provider, key or pepper for it: never a result. */
export const CHECK_REFUSAL = ["NO_CONSENT", "NO_KEY", "BUDGET_EXHAUSTED", "NOT_CONFIGURED"] as const;
export type CheckRefusal = (typeof CHECK_REFUSAL)[number];

/** The closed court category of a match; `NONE` for everything else. Never free text, never a record. */
export const CHECK_CATEGORY = ["TAL_NON_PAYMENT", "TAL_OTHER", "CRIMINAL", "CIVIL", "NONE"] as const;
export type CheckCategory = (typeof CHECK_CATEGORY)[number];

export interface CheckSubject {
  /** The opaque id of the subject on the product's side: consent and the audit are keyed on it, the names never are. */
  subjectId: string;
  lastName: string;
  firstName: string;
  /** ISO date, optional. */
  birthDate?: string;
  address?: string;
  /** For example `QC`: routes Québec court records to the Québec provider. */
  region?: string;
}

export interface StartCheckInput {
  subject: CheckSubject;
  /** The product's statement that the subject consented to this purpose. Without it Orazaka answers `REFUSED / NO_CONSENT` and asks nobody. */
  consented: boolean;
  /** The product's run this check belongs to, kept on the audit line. */
  runId?: string;
}

export interface CollectCheckInput {
  /** The subject the check was for. */
  subjectId: string;
  /** The consent must still stand: it is checked again at every poll. */
  consented: boolean;
}

/** The closed answer of a check, as Orazaka's `CheckResult`: an outcome and a category, no record. A refusal is an answer, not an exception. */
export interface CheckResult {
  purpose: "COURT_RECORDS" | "CREDIT" | "IDENTITY";
  outcome: CheckOutcome;
  refusal: CheckRefusal | null;
  category: CheckCategory;
  /** The provider's opaque reference: collect a `PENDING` check with it. */
  providerRef: string | null;
  runId: string | null;
}

const PURPOSES = ["COURT_RECORDS", "CREDIT", "IDENTITY"] as const;
const shape = (what: string) =>
  new OrazakaError(ORAZAKA_CODE.shape, `Orazaka's answer has an unexpected shape: ${what}`);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null;

/** Reads a check's answer from the edge's JSON; anything else is `ORAZAKA_SHAPE`. */
export function parseCheck(body: unknown): CheckResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const purpose = oneOf(PURPOSES, o.purpose);
  const outcome = oneOf(CHECK_OUTCOME, o.outcome);
  const category = oneOf(CHECK_CATEGORY, o.category ?? "NONE");
  if (!purpose || !outcome || !category) throw shape("a check needs a known purpose, outcome and category");
  const refusal = o.refusal === undefined || o.refusal === null ? null : oneOf(CHECK_REFUSAL, o.refusal);
  if ((outcome === "REFUSED") !== (refusal !== null))
    throw shape("a refusal comes with REFUSED, and REFUSED with a refusal");
  return { purpose, outcome, refusal, category, providerRef: text(o.providerRef), runId: text(o.runId) };
}
