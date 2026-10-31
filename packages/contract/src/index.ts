/**
 * Response contracts (krizaka-internal#1971, ADR-022). One zod schema per response, asserted in three places: a route test, a
 * journey, a synthetic monitor — and at the runtime boundary where we act on an answer (`fetchContract`). The class of defect it
 * closes: a response that lacks the fields its caller reads (« sent to undefined of undefined », « 204 = success ») and still passes.
 *
 * Fail-closed by construction: non-2xx, an empty or non-JSON body, a missing field, an `undefined` or `NaN` anywhere in the
 * answer, an empty string, all throw a `ContractError` naming the field's path — never its value (an answer may carry a secret).
 */
import { z } from "zod";

/** One broken field: its path (`recipients.0.id`) and why. The value is never reported. */
export interface ContractIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown by every assertion here. `issues` lists each field with its path; `status` is the HTTP status when there was one. */
export class ContractError extends Error {
  readonly issues: readonly ContractIssue[];
  readonly status: number | undefined;

  constructor(label: string, issues: readonly ContractIssue[], status?: number) {
    const where = status === undefined ? "" : ` (HTTP ${status})`;
    super(`${label}${where}: ${issues.map((i) => `${i.path || "(body)"} ${i.message}`).join("; ")}`);
    this.name = "ContractError";
    this.issues = issues;
    this.status = status;
  }
}

/** A required text: a non-empty string, trimmed length ≥ 1. */
export const text = () => z.string().trim().min(1, "must not be empty");

/** A count: a finite integer ≥ 0 (never `NaN`, `Infinity`, a fraction or a negative). */
export const count = () => z.number().int("must be an integer").nonnegative("must be ≥ 0").finite("must be finite");

/** A list that must hold at least one item. */
export const nonEmptyList = <T extends z.ZodType>(item: T) => z.array(item).min(1, "must have at least one item");

export interface ContractOptions {
  /** Allow empty strings in the answer (default false: an empty string in a required field fails). Declare optional text with `.optional()`. */
  readonly allowEmptyStrings?: boolean;
}

/** The part of a `fetch` Response a contract reads, so tests can pass a plain object. */
export interface ResponseLike {
  readonly status: number;
  text(): Promise<string>;
}

/** Walks a value for the holes a schema can let through (`z.unknown()`, `z.any()`, passthrough): undefined, NaN, empty strings. */
function holes(value: unknown, path: string, allowEmpty: boolean, out: ContractIssue[]): void {
  if (value === undefined) out.push({ path, message: "is undefined" });
  else if (typeof value === "number" && !Number.isFinite(value)) out.push({ path, message: "is not a finite number" });
  else if (typeof value === "string" && !allowEmpty && value.trim() === "")
    out.push({ path, message: "is an empty string" });
  else if (Array.isArray(value)) value.forEach((v, i) => holes(v, join(path, String(i)), allowEmpty, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) holes(v, join(path, k), allowEmpty, out);
  }
}

const join = (path: string, key: string) => (path === "" ? key : `${path}.${key}`);

/** Validates an already-parsed value: the schema, then the holes scan. Returns the parsed data or throws a `ContractError`. */
export function assertContract<S extends z.ZodType>(
  value: unknown,
  schema: S,
  options: ContractOptions & { readonly label?: string; readonly status?: number } = {},
): z.output<S> {
  const label = options.label ?? "contract";
  const issues: ContractIssue[] = [];
  const result = schema.safeParse(value);
  if (!result.success) {
    for (const i of result.error.issues) issues.push({ path: i.path.map(String).join("."), message: i.message });
    throw new ContractError(label, issues, options.status);
  }
  holes(result.data, "", options.allowEmptyStrings === true, issues);
  if (issues.length > 0) throw new ContractError(label, issues, options.status);
  return result.data;
}

/**
 * For route and integration tests: the response must be 2xx with a JSON body that satisfies `schema`. A 204 or an empty body
 * fails (a contract describes an answer). Returns the parsed body.
 */
export async function expectContract<S extends z.ZodType>(
  response: ResponseLike,
  schema: S,
  options: ContractOptions & { readonly label?: string } = {},
): Promise<z.output<S>> {
  const label = options.label ?? "response contract";
  if (response.status < 200 || response.status > 299) {
    throw new ContractError(label, [{ path: "", message: "status is not 2xx" }], response.status);
  }
  const raw = await response.text();
  if (raw.trim() === "") {
    throw new ContractError(label, [{ path: "", message: "has no body" }], response.status);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ContractError(label, [{ path: "", message: "is not JSON" }], response.status);
  }
  return assertContract(json, schema, { ...options, label, status: response.status });
}

export interface ProviderAnswerOptions extends ContractOptions {
  readonly label?: string;
  /** Field holding the accepted count (default `accepted`); it must be an integer ≥ 1. */
  readonly acceptedKey?: string;
  /** Field holding the provider's id for what it accepted (default `id`); it must be a non-empty string. */
  readonly idKey?: string;
  /** If we know how many we sent, the provider must have accepted exactly that many. */
  readonly expectedAccepted?: number;
}

/**
 * For a provider call we act on (mail, payments, storage): the contract of `schema` plus the proof of work — an accepted count ≥ 1
 * (or exactly `expectedAccepted`) and the provider's id. Returns the parsed answer.
 */
export async function expectProviderAnswer<S extends z.ZodType>(
  response: ResponseLike,
  schema: S,
  options: ProviderAnswerOptions = {},
): Promise<z.output<S>> {
  const label = options.label ?? "provider answer";
  const body = await expectContract(response, schema, { ...options, label });
  const acceptedKey = options.acceptedKey ?? "accepted";
  const idKey = options.idKey ?? "id";
  const record = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const issues: ContractIssue[] = [];
  const accepted = record[acceptedKey];
  if (typeof accepted !== "number" || !Number.isInteger(accepted) || accepted < 0) {
    issues.push({ path: acceptedKey, message: "must be the accepted count (an integer ≥ 0)" });
  } else if (options.expectedAccepted === undefined ? accepted < 1 : accepted !== options.expectedAccepted) {
    issues.push({
      path: acceptedKey,
      message: `accepted ${accepted}, expected ${options.expectedAccepted ?? "at least 1"}`,
    });
  }
  const id = record[idKey];
  if (typeof id !== "string" || id.trim() === "") issues.push({ path: idKey, message: "must be the provider's id" });
  if (issues.length > 0) throw new ContractError(label, issues, response.status);
  return body;
}

/** A named, reusable contract: the same schema for a route test, a journey and a monitor. */
export interface Contract<S extends z.ZodType> {
  readonly name: string;
  readonly schema: S;
  /** Asserts an already-parsed value. */
  assert(value: unknown): z.output<S>;
  /** Asserts a response (2xx, JSON body, schema). */
  expect(response: ResponseLike): Promise<z.output<S>>;
}

export function defineContract<S extends z.ZodType>(
  name: string,
  schema: S,
  options: ContractOptions = {},
): Contract<S> {
  return {
    name,
    schema,
    assert: (value) => assertContract(value, schema, { ...options, label: name }),
    expect: (response) => expectContract(response, schema, { ...options, label: name }),
  };
}

/**
 * The runtime boundary: calls `fetch`, then asserts the answer. Fails on a network error, a non-2xx, an empty or non-JSON body,
 * or a body that breaks the contract. The URL is never put in the error (it may carry a token).
 */
export async function fetchContract<S extends z.ZodType>(
  fetchFn: (input: string, init?: RequestInit) => Promise<ResponseLike>,
  input: string,
  init: RequestInit | undefined,
  contract: Contract<S> | S,
  options: ContractOptions & { readonly label?: string } = {},
): Promise<z.output<S>> {
  const label =
    options.label ?? ("name" in contract && typeof contract.name === "string" ? contract.name : "fetch contract");
  let response: ResponseLike;
  try {
    response = await fetchFn(input, init);
  } catch (cause) {
    throw new ContractError(label, [
      { path: "", message: `request failed: ${cause instanceof Error ? cause.name : "unknown error"}` },
    ]);
  }
  return "schema" in contract && "expect" in contract
    ? (contract as Contract<S>).expect(response)
    : expectContract(response, contract as S, { ...options, label });
}
