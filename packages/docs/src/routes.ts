import path from "node:path";

/** The file names the app router gives a screen and a route handler. */
export const SCREEN_FILE = /^page\.(tsx|ts|jsx|js)$/;
export const HANDLER_FILE = /^route\.(ts|js)$/;
/** The file that holds a screen's manual block, beside its page. */
export const MANUAL_FILE = "manual.ts";

/**
 * The address a file of the app router answers, relative to `root`: `(group)` and `@slot` folders are not in the address, a dynamic
 * segment keeps its brackets (`[id]`). Null when the file is not under `root`.
 */
export function routeOf(file: string, root: string): string | null {
  const relative = path.relative(root, path.dirname(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const segments = relative
    .split(path.sep)
    .filter((s) => s !== "" && !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
  return `/${segments.join("/")}`;
}

/** A segment's name without the brackets of a dynamic or catch-all segment: `[id]` → `id`, `[[...slug]]` → `slug`. */
function segmentName(segment: string): string {
  let name = segment;
  while (name.startsWith("[")) name = name.slice(1);
  while (name.endsWith("]")) name = name.slice(0, -1);
  return name.startsWith("...") ? name.slice(3) : name;
}

/** The slug of a route, for a page's address in the manual: `/app/documents/[id]` → `app-documents-id`; `/` → `home`. */
export function slugOf(route: string): string {
  const slug = route
    .split("/")
    .map(segmentName)
    .filter((s) => s !== "")
    .join("-");
  return slug === "" ? "home" : slug;
}
