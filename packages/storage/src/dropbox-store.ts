import { refreshDropboxToken } from "./dropbox-oauth";
import { assertKey, trimSlashes, typeOfName } from "./keys";
import { type Clock, type FetchLike, type ObjectInfo, type ObjectStore, STORAGE_CODE, StorageError } from "./port";

export interface DropboxStoreOptions {
  clientId: string;
  /** Sealed in the database; opened only to build the store. */
  refreshToken: string;
  /** Every file lives under this folder of the app's own folder, or none. */
  prefix?: string;
  fetch: FetchLike;
  clock: Clock;
}

/** One call takes up to 150 MB; above that, upload sessions of this size. */
// @fixed: Dropbox's documented single-call upload limit is 150 MB; chunks of 8 MiB stay far under every proxy limit
export const DROPBOX_SINGLE_CALL_BYTES = 150 * 1024 * 1024;
// @fixed: a chunk size inside the documented session limits
const CHUNK_BYTES = 8 * 1024 * 1024;
const CONTENT = "https://content.dropboxapi.com/2";
const API = "https://api.dropboxapi.com/2";

const fail = (what: string, status: number) =>
  new StorageError(STORAGE_CODE.provider, `Dropbox refused the ${what} (${status})`);
const encode = (json: unknown) => new TextEncoder().encode(JSON.stringify(json));
// Dropbox puts the JSON of a content call in a header: non-ASCII must be escaped.
const argHeader = (json: unknown) =>
  JSON.stringify(json).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * A person's Dropbox as an `ObjectStore`, App-folder access only. Dropbox's temporary links live 4 hours, longer than our 900 seconds, so
 * there is no signed link and no public link: the application streams the file. The access token is renewed from the refresh token;
 * a revoked or expired one answers `STORAGE_DISCONNECTED` and nothing is moved or deleted.
 */
export function dropboxStore(options: DropboxStoreOptions): ObjectStore {
  const prefix = trimSlashes(options.prefix ?? "");
  const pathOf = (key: string) => `/${prefix === "" ? "" : `${prefix}/`}${assertKey(key)}`;
  let access: { token: string; until: number } | null = null;
  const bearer = async () => {
    const now = options.clock.now().getTime();
    if (!access || access.until <= now) {
      const fresh = await refreshDropboxToken(options.fetch, {
        clientId: options.clientId,
        refreshToken: options.refreshToken,
      });
      access = { token: fresh.accessToken, until: now + (fresh.expiresInSeconds - 60) * 1000 };
    }
    return `Bearer ${access.token}`;
  };
  const call = async (url: string, headers: Record<string, string>, body?: Uint8Array) => {
    const res = await options.fetch(url, {
      method: "POST",
      headers: { authorization: await bearer(), ...headers },
      ...(body ? { body } : {}),
    });
    if (res.status === 401) {
      access = null;
      throw new StorageError(STORAGE_CODE.disconnected, "Dropbox no longer accepts this connection");
    }
    return res;
  };
  const json = (path: string, body: unknown) =>
    call(`${API}${path}`, { "content-type": "application/json" }, encode(body));
  const missing = async (res: Awaited<ReturnType<typeof call>>) =>
    res.status === 409 && (await res.text()).includes("not_found");

  const uploadSession = async (path: string, bytes: Uint8Array) => {
    const octet = { "content-type": "application/octet-stream" };
    const started = await call(
      `${CONTENT}/files/upload_session/start`,
      { ...octet, "dropbox-api-arg": argHeader({ close: false }) },
      bytes.subarray(0, CHUNK_BYTES),
    );
    if (!started.ok) throw fail("upload", started.status);
    const { session_id } = JSON.parse(await started.text()) as { session_id: string };
    let offset = Math.min(CHUNK_BYTES, bytes.length);
    while (bytes.length - offset > CHUNK_BYTES) {
      const sent = await call(
        `${CONTENT}/files/upload_session/append_v2`,
        { ...octet, "dropbox-api-arg": argHeader({ cursor: { session_id, offset }, close: false }) },
        bytes.subarray(offset, offset + CHUNK_BYTES),
      );
      if (!sent.ok) throw fail("upload", sent.status);
      offset += CHUNK_BYTES;
    }
    const done = await call(
      `${CONTENT}/files/upload_session/finish`,
      {
        ...octet,
        "dropbox-api-arg": argHeader({
          cursor: { session_id, offset },
          commit: { path, mode: "overwrite", mute: true },
        }),
      },
      bytes.subarray(offset),
    );
    if (!done.ok) throw fail("upload", done.status);
  };

  return {
    async put(key, bytes) {
      const path = pathOf(key);
      if (bytes.length > DROPBOX_SINGLE_CALL_BYTES) return uploadSession(path, bytes);
      const res = await call(
        `${CONTENT}/files/upload`,
        {
          "content-type": "application/octet-stream",
          "dropbox-api-arg": argHeader({ path, mode: "overwrite", mute: true }),
        },
        bytes,
      );
      if (!res.ok) throw fail("upload", res.status);
    },
    async get(key) {
      const res = await call(`${CONTENT}/files/download`, { "dropbox-api-arg": argHeader({ path: pathOf(key) }) });
      if (await missing(res)) return null;
      if (!res.ok) throw fail("download", res.status);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: typeOfName(key) };
    },
    async head(key) {
      const res = await json("/files/get_metadata", { path: pathOf(key) });
      if (await missing(res)) return null;
      if (!res.ok) throw fail("head", res.status);
      return { key, size: (JSON.parse(await res.text()) as { size: number }).size };
    },
    async delete(key) {
      const res = await json("/files/delete_v2", { path: pathOf(key) });
      if (!res.ok && !(await missing(res))) throw fail("delete", res.status);
    },
    async list(under) {
      const root = `/${prefix}`.replace(/\/$/, "");
      const out: ObjectInfo[] = [];
      let res = await json("/files/list_folder", { path: root, recursive: true });
      for (;;) {
        if (await missing(res)) return [];
        if (!res.ok) throw fail("listing", res.status);
        const page = JSON.parse(await res.text()) as {
          entries: { ".tag": string; path_display: string; size?: number }[];
          has_more: boolean;
          cursor: string;
        };
        for (const entry of page.entries) {
          const key = entry.path_display.slice(root.length + 1);
          if (entry[".tag"] === "file" && key.startsWith(under)) out.push({ key, size: entry.size ?? 0 });
        }
        if (!page.has_more) break;
        res = await json("/files/list_folder/continue", { cursor: page.cursor });
      }
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
    signedUrl: async () => null,
    publicUrl: () => null,
  };
}
