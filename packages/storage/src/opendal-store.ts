import type { Readable } from "node:stream";

import type { Operator } from "opendal";

import { checkEndpointDns, type Resolver } from "./dns-check";
import { checkEndpoint } from "./endpoint";
import { assertKey, trimSlashes, typeOfName } from "./keys";
import { type ObjectInfo, type ObjectStore, STORAGE_CODE, StorageError } from "./port";

/**
 * The OpenDAL services this package lets a provider open (ADR-005 amendment, krizaka-ts#235), as data. OpenDAL's npm binding ships
 * about fifty schemes, among them databases and caches (`postgresql`, `redis`, `memcached`…): only the ones listed here are files we
 * may keep, so a coordinate typed by an admin can never open anything else.
 * - `endpoint`: the option an admin or a user types (checked by `checkEndpoint` and the DNS check before OpenDAL is called);
 * - `auth`: `keys` (static credentials, sealed), `oauth` (a short-lived access token from `cloud-connectors.ts`), `none`;
 * - `local`: reads the server's disk or memory, so only with `allowLocal` (development, tests).
 */
export const OPENDAL_SERVICES = {
  s3: { endpoint: "endpoint", auth: "keys", local: false },
  gcs: { endpoint: "endpoint", auth: "keys", local: false },
  azblob: { endpoint: "endpoint", auth: "keys", local: false },
  b2: { endpoint: null, auth: "keys", local: false },
  swift: { endpoint: "endpoint", auth: "keys", local: false },
  webdav: { endpoint: "endpoint", auth: "keys", local: false },
  gdrive: { endpoint: null, auth: "oauth", local: false },
  onedrive: { endpoint: null, auth: "oauth", local: false },
  dropbox: { endpoint: null, auth: "oauth", local: false },
  fs: { endpoint: null, auth: "none", local: true },
  memory: { endpoint: null, auth: "none", local: true },
} as const satisfies Record<string, { endpoint: string | null; auth: "keys" | "oauth" | "none"; local: boolean }>;
export type OpendalService = keyof typeof OPENDAL_SERVICES;

export interface OpendalStoreOptions {
  service: string;
  /** The service's OpenDAL options: coordinates and, for `keys` services, the opened credentials. Never logged. */
  options: Readonly<Record<string, string>>;
  /** `oauth` services: a fresh access token (the connector renews it). Called before each operation; the operator is rebuilt when it changes. */
  accessToken?: () => Promise<string>;
  /** Every file lives under this folder, or none. */
  prefix?: string;
  /** Development and tests only: `fs`/`memory`, and an `http` or local endpoint (MinIO on the Mac). Never on a deployed server. */
  allowLocal?: boolean;
  /** The DNS check's resolver (tests inject one); the system resolver otherwise. */
  resolve?: Resolver;
}

const kindOf = (message: string) => /^([A-Za-z]+) \(/.exec(message)?.[1] ?? "";

/**
 * OpenDAL's errors carry their kind as the first word of the message (`NotFound (permanent) at read…`): mapped onto this package's
 * codes. A refused credential on an `oauth` service is a lost connection (`STORAGE_DISCONNECTED`: nothing is moved or deleted).
 * The message is not passed on: it may quote a path or a provider's answer.
 */
export function storageErrorOf(error: unknown, auth: "keys" | "oauth" | "none", what: string): StorageError {
  if (error instanceof StorageError) return error;
  const kind = kindOf(error instanceof Error ? error.message : String(error));
  if (kind === "PermissionDenied" && auth === "oauth") return new StorageError(STORAGE_CODE.disconnected, "The cloud no longer accepts this connection");
  if (kind === "ConfigInvalid" || kind === "Unsupported") return new StorageError(STORAGE_CODE.badConfig, `The provider's settings are not valid (${kind})`);
  return new StorageError(STORAGE_CODE.provider, `The provider refused the ${what} (${kind || "unknown"})`);
}

const isNotFound = (error: unknown) => error instanceof Error && kindOf(error.message) === "NotFound";

let binding: Promise<typeof import("opendal")> | null = null;
/** The native module is loaded on first use, never at import: a product that opens no OpenDAL provider never loads it. */
const loadOpendal = () => (binding ??= import("opendal").catch(() => {
  binding = null;
  throw new StorageError(STORAGE_CODE.badConfig, "This provider needs the optional dependency `opendal`");
}));

/** The port, plus a streaming read for large files (the port reads whole files): OpenDAL's reader as a Node stream. */
export interface OpendalObjectStore extends ObjectStore {
  readStream(key: string): Promise<Readable>;
}

/**
 * One adapter over Apache OpenDAL for the providers that have no adapter of their own (Google Drive, OneDrive, Azure Blob, GCS,
 * Backblaze B2, Swift, WebDAV/Nextcloud…). The service must be in `OPENDAL_SERVICES`; a typed endpoint passes `checkEndpoint` and the
 * DNS check before OpenDAL is called (OpenDAL resolves names itself: the product's egress rules stay the second guard).
 * Signed links only where the service presigns (S3, GCS); public links never.
 * @throws StorageError `STORAGE_BAD_CONFIG` (unknown service, local service without `allowLocal`), `STORAGE_BAD_ENDPOINT`
 */
export async function opendalStore(input: OpendalStoreOptions): Promise<OpendalObjectStore> {
  const service = (OPENDAL_SERVICES as Record<string, (typeof OPENDAL_SERVICES)[OpendalService] | undefined>)[input.service];
  if (!service) throw new StorageError(STORAGE_CODE.badConfig, `Unknown file service: ${input.service}`);
  if (service.local && !input.allowLocal) throw new StorageError(STORAGE_CODE.badConfig, `${input.service} reads the server's own disk or memory: development only`);
  if (service.auth === "oauth" && !input.accessToken) throw new StorageError(STORAGE_CODE.badConfig, `${input.service} needs a connected account`);
  const options: Record<string, string> = { ...input.options };
  if (service.endpoint && options[service.endpoint] !== undefined) {
    const allowLocal = input.allowLocal === true;
    options[service.endpoint] = checkEndpoint(options[service.endpoint]!, { allowLocal });
    if (!allowLocal) await checkEndpointDns(options[service.endpoint]!, input.resolve ? { resolve: input.resolve } : {});
  }
  const { Operator: OperatorClass } = await loadOpendal();
  const prefix = trimSlashes(input.prefix ?? "");
  const pathOf = (key: string) => `${prefix === "" ? "" : `${prefix}/`}${assertKey(key)}`;
  const auth = service.auth;

  let current: { token: string | null; op: Operator } | null = null;
  const operator = async (): Promise<Operator> => {
    const token = input.accessToken ? await input.accessToken() : null;
    if (!current || current.token !== token) {
      try {
        current = { token, op: new OperatorClass(input.service, token === null ? options : { ...options, access_token: token }) };
      } catch (error) {
        throw storageErrorOf(error, auth, "connection");
      }
    }
    return current.op;
  };
  const run = async <T>(what: string, act: (op: Operator) => Promise<T>, onMissing?: { value: T }): Promise<T> => {
    const op = await operator();
    try {
      return await act(op);
    } catch (error) {
      if (onMissing && isNotFound(error)) return onMissing.value;
      throw storageErrorOf(error, auth, what);
    }
  };

  return {
    async put(key, bytes, meta) {
      const path = pathOf(key);
      await run("upload", async (op) => {
        await op.write(path, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), op.capability().writeWithContentType ? { contentType: meta.contentType } : undefined);
      });
    },
    async get(key) {
      const path = pathOf(key);
      const bytes = await run("download", async (op) => new Uint8Array(await op.read(path)), { value: null });
      return bytes && { bytes, contentType: typeOfName(key) };
    },
    async head(key) {
      const path = pathOf(key);
      const meta = await run("head", (op) => op.stat(path), { value: null });
      return meta && { key, size: Number(meta.contentLength ?? 0n) };
    },
    async delete(key) {
      const path = pathOf(key);
      await run("delete", (op) => op.delete(path));
    },
    async list(under) {
      const root = prefix === "" ? "" : `${prefix}/`;
      const entries = await run("listing", (op) => op.list(root === "" ? "/" : root, { recursive: true }), { value: [] });
      const out: ObjectInfo[] = [];
      for (const entry of entries) {
        const meta = entry.metadata();
        const key = entry.path().replace(/^\//, "").slice(root.length);
        if (meta.isFile() && key.startsWith(under)) out.push({ key, size: Number(meta.contentLength ?? 0n) });
      }
      return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
    async signedUrl(key, ttlSeconds) {
      const path = pathOf(key);
      return run("signed link", async (op) => (op.capability().presignRead ? (await op.presignRead(path, ttlSeconds)).url : null));
    },
    publicUrl: () => null,
    async readStream(key) {
      const path = pathOf(key);
      return run("download", async (op) => (await op.reader(path)).createReadStream());
    },
  };
}
