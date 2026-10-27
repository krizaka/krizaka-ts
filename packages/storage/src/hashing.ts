import { createHash } from "node:crypto";

/** The first 10 hex characters of the SHA-256: the rule of the Krizaka media library (`name.<hash>.ext`). */
export const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 10);

/** `photo.jpg` and its bytes give `photo.<sha10>.jpg`: a URL never changes content, so it is cached for good. */
export function hashedName(name: string, bytes: Uint8Array): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${base}.${hashOf(bytes)}${ext}`;
}
