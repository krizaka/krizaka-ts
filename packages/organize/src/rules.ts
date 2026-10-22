/**
 * The pure rules of « organize »: names, tag colours, ids, and the `tags` parameter of a view (the URL is the state). No I/O.
 */
// @fixed: the length of a name column and of its field in a form
export const NAME_MAX = 80;
// @fixed: the length of a description (plain text or light markdown)
export const DESCRIPTION_MAX = 500;

/** Tag colours are NAMES that the UI maps to its tokens — never a hex in the database. */
export const TAG_COLORS = ["blue", "green", "amber", "red", "violet", "gray"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const isTagColor = (value: unknown): value is TagColor => typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** What an entity or a collection may be called: spaces collapsed, trimmed, 1 to NAME_MAX characters; null when it is not. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return name && name.length <= NAME_MAX ? name : null;
}

/** A description: trimmed, at most DESCRIPTION_MAX characters; empty means none (null). null when too long. */
export function cleanDescription(raw: string | null | undefined): { value: string | null } | null {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (text.length > DESCRIPTION_MAX) return null;
  return { value: text || null };
}

/** `?tags=a,b` (or the repeated form) → the ids, in order, without duplicates and without anything that is not an id. */
export function parseTagsParam(value: string | readonly string[] | undefined): string[] {
  const parts = (Array.isArray(value) ? value : [value ?? ""]).flatMap((v: string) => v.split(","));
  return [...new Set(parts.map((p) => p.trim()).filter(isId))];
}

export const toggleTag = (current: readonly string[], id: string): string[] => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]);

/** The same path with another set of tags: the URL is the state. */
export const tagsHref = (path: string, tags: readonly string[]): string => (tags.length ? `${path}?tags=${tags.join(",")}` : path);
