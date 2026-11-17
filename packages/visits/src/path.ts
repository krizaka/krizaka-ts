// @fixed: a page address longer than this is an attack or a mistake, not a page to count
const MAX_PATH_LENGTH = 200;
// @fixed: the sites' deepest counted page is a chapter or a doc three levels down
const MAX_SEGMENTS = 5;
const NEVER = /^\/(api|_next|\.well-known|healthz|_vercel)(\/|$)/;
const FILE = /\.[a-z0-9]{1,6}$/i;

/**
 * The page a visit counts for: the path alone, never the query nor the fragment (they can carry a name or a token), in lower case,
 * without a trailing slash. `null` for what is not a page (an API, an asset, a file, an address that is not a path).
 */
export function normalisePath(input: string | null | undefined): string | null {
  if (!input?.startsWith("/") || input.startsWith("//")) return null;
  const bare = input.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const path =
    decoded
      .toLowerCase()
      .replaceAll(/\/{2,}/g, "/")
      .replace(/\/+$/, "") || "/";
  if (path.length > MAX_PATH_LENGTH || NEVER.test(path) || FILE.test(path)) return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length > MAX_SEGMENTS) return null;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\s]/.test(path) ? null : path;
}
