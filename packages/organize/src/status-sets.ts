/**
 * Status sets as data (ADR-003 §2): ordered states with a tone and FR/EN labels, the transitions and the roles that may make them,
 * final states, a confirm hint, reasons as a list. Pure rules, browser-safe: the web, the phone and macOS read the same ones.
 */
import { ORGANIZE_CODE, OrganizeError } from "./errors";
import { isRecord } from "./rules";

/** A text in both languages of the products. */
export interface Label {
  fr: string;
  en: string;
}

/** The tones of a status: the badge tones of Krizaka UI, never a tag marker. */
export const STATUS_TONES = ["neutral", "accent", "success", "warning", "danger"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/** `editable`: people move it, through its transitions. `derived`: the product computes it (a ledger, a check-in); nobody moves it. */
export const STATUS_MODE = { editable: "editable", derived: "derived" } as const;
export type StatusMode = (typeof STATUS_MODE)[keyof typeof STATUS_MODE];

export interface StatusState {
  key: string;
  label: Label;
  tone: StatusTone;
  /** A final state has no way out (Yomizaka's decision closes the file). */
  final?: boolean;
}

export interface StatusReason {
  key: string;
  label: Label;
}

export interface StatusTransition {
  from: string;
  to: string;
  /** The roles that may make this move. */
  roles: readonly string[];
  /** The UI asks for a second press. */
  confirm?: boolean;
  /** The reasons a mover may pick, as data. None means no reason is accepted — there is never a free-text reason. */
  reasons?: readonly StatusReason[];
}

export interface StatusSet {
  key: string;
  label: Label;
  mode: StatusMode;
  /** In the set's order: the order of a status column, never a computed value. */
  states: readonly StatusState[];
  /** Editable sets: the state of an entity nobody moved yet. */
  initial?: string;
  transitions: readonly StatusTransition[];
}

// @fixed: the length of a label on a chip, in either language
export const LABEL_MAX = 40;
// @fixed: a set is a short vocabulary, read at a glance
export const STATES_MAX = 12;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** A key of a state, a set, a reason, a role or a system view: lower-case letters, digits, underscore. */
export const isKey = (value: unknown): value is string => typeof value === "string" && KEY.test(value);

const isLabelText = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= LABEL_MAX;

/** Whether a value is a label in both languages, each 1 to LABEL_MAX characters. */
export const isLabel = (value: unknown): value is Label => isRecord(value) && isLabelText(value.fr) && isLabelText(value.en);

function keyedProblems(items: unknown, what: string, extra: (item: Record<string, unknown>, at: string) => string[]): string[] {
  if (!Array.isArray(items)) return [`${what} must be a list`];
  const seen = new Set<string>();
  return items.flatMap((item, i): string[] => {
    const at = `${what}[${i}]`;
    if (!isRecord(item) || !isKey(item.key)) return [`${at}: a key is lower-case letters, digits and _`];
    const out = seen.has(item.key) ? [`${at}: the key « ${item.key} » is used twice`] : [];
    seen.add(item.key);
    if (!isLabel(item.label)) out.push(`${at}: a label has fr and en, 1 to ${LABEL_MAX} characters`);
    return [...out, ...extra(item, at)];
  });
}

function transitionProblems(set: Record<string, unknown>, states: Map<string, Record<string, unknown>>): string[] {
  if (!Array.isArray(set.transitions)) return ["transitions must be a list"];
  const pairs = new Set<string>();
  return set.transitions.flatMap((t, i): string[] => {
    const at = `transitions[${i}]`;
    if (!isRecord(t)) return [`${at}: not a transition`];
    const out: string[] = [];
    const from = states.get(String(t.from));
    if (!from || !states.has(String(t.to))) out.push(`${at}: from and to are states of the set`);
    if (t.from === t.to) out.push(`${at}: a move goes to another state`);
    if (from?.final === true) out.push(`${at}: a final state has no way out`);
    const pair = `${String(t.from)}→${String(t.to)}`;
    if (pairs.has(pair)) out.push(`${at}: ${pair} is declared twice`);
    pairs.add(pair);
    if (!Array.isArray(t.roles) || t.roles.length === 0 || !t.roles.every(isKey)) out.push(`${at}: roles is a non-empty list of role keys`);
    if (t.confirm !== undefined && typeof t.confirm !== "boolean") out.push(`${at}: confirm is true or false`);
    if (t.reasons !== undefined) out.push(...keyedProblems(t.reasons, `${at}.reasons`, () => []));
    return out;
  });
}

/**
 * What is wrong with a status set (an admin's editor sends it as JSON).
 * @param input the set to check
 * @returns the problems, empty when the set is valid
 */
export function statusSetProblems(input: unknown): string[] {
  if (!isRecord(input)) return ["a status set is an object"];
  const out: string[] = [];
  if (!isKey(input.key)) out.push("key: lower-case letters, digits and _");
  if (!isLabel(input.label)) out.push(`label: fr and en, 1 to ${LABEL_MAX} characters`);
  const modes: readonly unknown[] = Object.values(STATUS_MODE);
  if (!modes.includes(input.mode)) out.push("mode: editable or derived");
  out.push(
    ...keyedProblems(input.states, "states", (s, at) => [
      ...((STATUS_TONES as readonly unknown[]).includes(s.tone) ? [] : [`${at}: tone is one of ${STATUS_TONES.join(", ")}`]),
      ...(s.final === undefined || typeof s.final === "boolean" ? [] : [`${at}: final is true or false`]),
    ]),
  );
  const states = new Map(Array.isArray(input.states) ? input.states.filter(isRecord).map((s) => [String(s.key), s] as const) : []);
  if (Array.isArray(input.states) && (input.states.length < 2 || input.states.length > STATES_MAX)) out.push(`states: 2 to ${STATES_MAX}`);
  return [...out, ...(input.mode === STATUS_MODE.derived ? derivedProblems(input) : editableProblems(input, states))];
}

function derivedProblems(set: Record<string, unknown>): string[] {
  return [
    ...(set.initial === undefined ? [] : ["a derived set has no initial state"]),
    ...(Array.isArray(set.transitions) && set.transitions.length === 0 ? [] : ["a derived set has no transitions: nobody moves it"]),
  ];
}

function editableProblems(set: Record<string, unknown>, states: Map<string, Record<string, unknown>>): string[] {
  const initial = states.get(String(set.initial));
  const first = !initial ? ["initial: a state of the set"] : initial.final === true ? ["initial: never a final state"] : [];
  return [...first, ...transitionProblems(set, states)];
}

/**
 * A status set as the layer keeps it.
 * @throws OrganizeError `BAD_REQUEST` listing every problem
 */
export function checkStatusSet(input: unknown): StatusSet {
  const problems = statusSetProblems(input);
  if (problems.length > 0) throw new OrganizeError(ORGANIZE_CODE.badRequest, problems.join("; "));
  return input as StatusSet;
}

/** The state of the set with this key, or undefined. */
export const stateOf = (set: StatusSet, key: string): StatusState | undefined => set.states.find((s) => s.key === key);

/**
 * The moves a role may make from a state, in the set's order of their targets.
 * @returns none for a derived set or a final state
 */
export function movesFrom(set: StatusSet, from: string, role: string): StatusTransition[] {
  if (set.mode !== STATUS_MODE.editable) return [];
  const order = statusOrder(set);
  return set.transitions.filter((t) => t.from === from && t.roles.includes(role)).sort((a, b) => (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0));
}

/**
 * Checks one move against the set: it is editable, the move is declared, the role may make it, the reason is one of the list.
 * @returns the transition
 * @throws OrganizeError `STATUS_DERIVED`, `MOVE_NOT_ALLOWED`, `FORBIDDEN` or `BAD_REQUEST` (a reason the move does not accept)
 */
export function checkMove(set: StatusSet, move: { from: string; to: string; role: string; reason?: string | null }): StatusTransition {
  if (set.mode !== STATUS_MODE.editable) throw new OrganizeError(ORGANIZE_CODE.statusDerived);
  const transition = set.transitions.find((t) => t.from === move.from && t.to === move.to);
  if (!transition) throw new OrganizeError(ORGANIZE_CODE.moveNotAllowed, `${move.from} → ${move.to}`);
  if (!transition.roles.includes(move.role)) throw new OrganizeError(ORGANIZE_CODE.forbidden);
  if (move.reason != null && !(transition.reasons ?? []).some((r) => r.key === move.reason)) throw new OrganizeError(ORGANIZE_CODE.badRequest, "Not a reason of this move");
  return transition;
}

/**
 * The move that undoes one: the reverse transition, only when the move did not reach a final state and the role may make it.
 * @returns the reverse transition, or null
 */
export function undoOf(set: StatusSet, move: { from: string; to: string }, role: string): StatusTransition | null {
  if (set.mode !== STATUS_MODE.editable || stateOf(set, move.to)?.final === true) return null;
  return set.transitions.find((t) => t.from === move.to && t.to === move.from && t.roles.includes(role)) ?? null;
}

/** Each state's place in the set: what a status column sorts by — never a score. */
export const statusOrder = (set: StatusSet): Map<string, number> => new Map(set.states.map((s, i) => [s.key, i]));
