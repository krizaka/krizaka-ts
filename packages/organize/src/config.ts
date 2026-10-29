/**
 * The admin's configuration of one kind (ADR-003 §2): who writes its tags, whether users add their own, the presets, its status set,
 * its system views. Kept in the database (the source of truth); this file holds its shape and its rules, browser-safe.
 */
import { ORGANIZE_CODE, OrganizeError } from "./errors";
import { cleanName, isRecord, isTagColor, TAG_COLORS, type TagColor } from "./rules";
import { isKey, isLabel, type Label, type StatusSet, statusSetProblems } from "./status-sets";
import { checkViewFilters, type ViewFilters } from "./views";

/** The marker of a tag: a name of the closed palette, mapped by @krizaka/tokens to `--kz-tag-<name>` (never a hex). */
export const MARKERS = TAG_COLORS;
export type Marker = TagColor;
export const isMarker = isTagColor;

export interface TagPreset {
  name: string;
  marker: Marker;
}

export interface SystemView {
  key: string;
  label: Label;
  filters: ViewFilters;
}

export interface KindConfig {
  kind: string;
  tags: {
    /** The roles that create, rename, remove and assign tags. */
    writers: string[];
    /** Whether a writer may create tags beyond the presets. */
    userTags: boolean;
    /** Tags per scope and kind. */
    max: number;
    /** The admin's default tag sets, by variant (a trade, or `default`). */
    presets: Record<string, TagPreset[]>;
  };
  status: StatusSet | null;
  views: SystemView[];
}

// @fixed: the most tags one scope keeps for one kind, whatever the admin sets
export const TAGS_MAX = 200;
// @fixed: the system views a list shows before « more »
export const SYSTEM_VIEWS_MAX = 12;

function presetProblems(presets: unknown, max: number): string[] {
  if (!isRecord(presets)) return ["tags.presets: an object of variants"];
  return Object.entries(presets).flatMap(([variant, list]): string[] => {
    const at = `tags.presets.${variant}`;
    if (!isKey(variant)) return [`${at}: a variant is a key`];
    if (!Array.isArray(list) || list.length > max) return [`${at}: a list of at most tags.max tags`];
    const names = new Set<string>();
    return list.flatMap((p, i): string[] => {
      if (!isRecord(p) || typeof p.name !== "string" || cleanName(p.name) !== p.name || !isMarker(p.marker))
        return [`${at}[${i}]: a name (1 to 80 characters, trimmed) and a marker of ${MARKERS.join(", ")}`];
      const lower = p.name.toLowerCase();
      if (names.has(lower)) return [`${at}[${i}]: « ${p.name} » twice`];
      names.add(lower);
      return [];
    });
  });
}

function viewProblems(views: unknown, status: StatusSet | null): string[] {
  if (!Array.isArray(views) || views.length > SYSTEM_VIEWS_MAX) return [`views: a list of at most ${SYSTEM_VIEWS_MAX}`];
  const keys = new Set<string>();
  return views.flatMap((v, i): string[] => {
    const at = `views[${i}]`;
    if (!isRecord(v) || !isKey(v.key) || !isLabel(v.label)) return [`${at}: a key and a label in fr and en`];
    const out = keys.has(v.key) ? [`${at}: the key « ${v.key} » is used twice`] : [];
    keys.add(v.key);
    try {
      checkViewFilters(v.filters, status);
    } catch (error) {
      out.push(`${at}.filters: ${(error as Error).message}`);
    }
    return out;
  });
}

/**
 * What is wrong with a kind's configuration (the admin's editor sends it as JSON).
 * @returns the problems, empty when it is valid
 */
export function kindConfigProblems(input: unknown): string[] {
  if (!isRecord(input)) return ["a configuration is an object"];
  const out: string[] = [];
  if (!isKey(input.kind)) out.push("kind: a key");
  const tags = input.tags;
  if (!isRecord(tags)) out.push("tags: an object");
  else {
    if (!Array.isArray(tags.writers) || !tags.writers.every(isKey)) out.push("tags.writers: a list of role keys");
    if (typeof tags.userTags !== "boolean") out.push("tags.userTags: true or false");
    const max =
      Number.isInteger(tags.max) && (tags.max as number) >= 1 && (tags.max as number) <= TAGS_MAX
        ? (tags.max as number)
        : null;
    if (max === null) out.push(`tags.max: 1 to ${TAGS_MAX}`);
    out.push(...presetProblems(tags.presets, max ?? TAGS_MAX));
  }
  const status = input.status ?? null;
  const statusProblems = status === null ? [] : statusSetProblems(status);
  out.push(
    ...statusProblems.map((p) => `status: ${p}`),
    ...viewProblems(input.views, statusProblems.length === 0 ? (status as StatusSet | null) : null),
  );
  return out;
}

/**
 * A kind's configuration as the layer keeps it.
 * @throws OrganizeError `BAD_REQUEST` listing every problem
 */
export function checkKindConfig(input: unknown): KindConfig {
  const problems = kindConfigProblems(input);
  if (problems.length > 0) throw new OrganizeError(ORGANIZE_CODE.badRequest, problems.join("; "));
  return { ...(input as KindConfig), status: (input as KindConfig).status ?? null };
}

/** The states a new configuration drops from the old one: entities must not hold them (`STATE_IN_USE`). */
export function droppedStates(before: KindConfig | null, after: KindConfig): string[] {
  const kept = new Set(after.status?.states.map((s) => s.key) ?? []);
  return (before?.status?.states ?? []).map((s) => s.key).filter((k) => !kept.has(k));
}
