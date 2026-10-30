import { STORAGE_CODE, StorageError } from "./port";

// @fixed: S3's own limit on a key; a longer one is refused by every provider
const MAX_KEY = 1024;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ ()@+=,~-]*$/;

/** Trims slashes at the ends without a regular expression (a long run of slashes must not be quadratic). */
export function trimSlashes(value: string, ends: "both" | "end" = "both"): string {
  let start = 0;
  let end = value.length;
  if (ends === "both") while (start < end && value[start] === "/") start += 1;
  while (end > start && value[end - 1] === "/") end -= 1;
  return value.slice(start, end);
}

/**
 * A key is `a/b/name.ext`: no empty segment, no `.` or `..`, no leading or trailing slash, no backslash, no control character.
 * @throws StorageError `STORAGE_BAD_KEY`
 */
export function assertKey(key: string): string {
  const bad = (why: string) => new StorageError(STORAGE_CODE.badKey, `${why}: « ${key.slice(0, 80)} »`);
  if (typeof key !== "string" || key === "" || key.length > MAX_KEY) throw bad("a key is 1 to 1024 characters");
  for (const segment of key.split("/")) {
    if (segment === "." || segment === "..") throw bad("a key has no . or .. segment");
    if (!SEGMENT.test(segment)) throw bad("a key segment is empty or has a character storage services refuse");
  }
  return key;
}

/**
 * The prefixes a zone allows, as data: an unknown prefix is refused. A layout lists prefixes WITH a trailing slash (`site/home/`);
 * a key belongs to the prefix it starts with.
 */
export interface Layout {
  prefixes: readonly string[];
  /** The prefix a key belongs to, or `null`. */
  prefixOf(key: string): string | null;
  /** @throws StorageError `STORAGE_BAD_PREFIX` when the key is under no declared prefix. */
  check(key: string): string;
}

export function defineLayout(prefixes: readonly string[]): Layout {
  for (const p of prefixes)
    if (!p.endsWith("/"))
      throw new StorageError(STORAGE_CODE.badPrefix, `layout prefix « ${p} » must end with a slash`);
  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  const prefixOf = (key: string) => sorted.find((p) => key.startsWith(p)) ?? null;
  return {
    prefixes,
    prefixOf,
    check(key) {
      assertKey(key);
      if (prefixOf(key) === null)
        throw new StorageError(STORAGE_CODE.badPrefix, `« ${key.slice(0, 80)} » is under no declared prefix`);
      return key;
    },
  };
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  json: "application/json",
  txt: "text/plain",
  vtt: "text/vtt",
};

/** The content type a file name suggests, for stores that do not keep one. Never a security decision: see `sniffType`. */
export const typeOfName = (key: string): string =>
  TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
