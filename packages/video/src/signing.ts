import { createHash, createHmac } from "node:crypto";

const sha256 = (data: string) => createHash("sha256").update(data);
const urlSafe = (base64: string) => base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/**
 * The signature of a TUS upload (Stream docs, « TUS resumable uploads »): hex SHA-256 of `libraryId + apiKey + expires + videoId`,
 * concatenated with no separator, `expires` in Unix seconds. It is computed on the SERVER: the client gets the signature, not the key.
 */
export const tusSignature = (input: { libraryId: string; apiKey: string; expires: number; videoId: string }): string => sha256(`${input.libraryId}${input.apiKey}${input.expires}${input.videoId}`).digest("hex");

/**
 * The token of the embedded web player (Stream docs, « Embedded view token authentication »): hex SHA-256 of
 * `tokenKey + videoId + expires`. The token key is the library's « Token authentication key », not its API key.
 */
export const embedToken = (input: { tokenKey: string; videoId: string; expires: number }): string => sha256(`${input.tokenKey}${input.videoId}${input.expires}`).digest("hex");

/**
 * The token of the mobile SDKs (Stream docs, « Token authentication with Mobile SDKs »): HMAC-SHA256, keyed by the library API key,
 * over `apiKey + videoId + expires`, hex; the token is the base64 of `<signature>:<expires>`.
 */
export function mobileViewToken(input: { apiKey: string; videoId: string; expires: number }): string {
  const signature = createHmac("sha256", input.apiKey).update(`${input.apiKey}${input.videoId}${input.expires}`).digest("hex");
  return Buffer.from(`${signature}:${input.expires}`).toString("base64");
}

/**
 * CDN token authentication for ONE FILE (a poster, a preview): SHA-256 of `key + path + expires`, URL-safe base64, sent as
 * `?token=…&expires=…`. As run in production by Orochia against Bunny's pull zones.
 */
export function signedFileUrl(input: { hostname: string; path: string; tokenKey: string; expires: number }): string {
  const token = urlSafe(sha256(`${input.tokenKey}${input.path}${input.expires}`).digest("base64"));
  return `https://${input.hostname}${input.path}?token=${token}&expires=${input.expires}`;
}

/**
 * CDN token authentication for a DIRECTORY (a video's playlist, renditions and segments): SHA-256 of
 * `key + path + expires + [ip] + "token_path=" + path`, URL-safe base64. The token sits in the PATH
 * (`/bcdn_token=…&expires=…&token_path=…/<path>file`), because an HLS player asks for renditions and segments by relative URL, which keeps
 * the path and drops a query string. As run in production by Orochia.
 */
export function signedDirectoryUrl(input: { hostname: string; directory: string; file: string; tokenKey: string; expires: number; ip?: string }): string {
  const token = urlSafe(sha256(`${input.tokenKey}${input.directory}${input.expires}${input.ip ?? ""}token_path=${input.directory}`).digest("base64"));
  return `https://${input.hostname}/bcdn_token=${token}&expires=${input.expires}&token_path=${encodeURIComponent(input.directory)}${input.directory}${input.file}`;
}
