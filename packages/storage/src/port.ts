/**
 * The ports of « storage »: files behind one interface, named by what it does. Generic: no vendor SDK (adapters speak plain HTTP
 * through an injected `fetch`), no environment variable (credentials come in as parameters), no wall clock (a `Clock` signs the links).
 */
export type { Clock } from "@krizaka/db";

/** The part of `fetch` the adapters use: inject the global one (`fetch`), or a fake in a test. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectInfo {
  key: string;
  size: number;
}

/** One place files live. Every adapter runs `objectStoreContract` (`@krizaka/storage/testkit`). Keys are `a/b/name.ext`, checked by `assertKey`. */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, meta: { contentType: string }): Promise<void>;
  /** `null` when there is no such file. */
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectInfo | null>;
  /** Idempotent: deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
  /** Every file whose key starts with `prefix`, in key order, directories flattened. */
  list(prefix: string): Promise<ObjectInfo[]>;
  /** A link valid for `ttlSeconds` for a private file, or `null` when the store cannot sign one. */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;
  /** The permanent public link (a pull zone, a CDN), or `null` when the zone is private. */
  publicUrl(key: string): string | null;
}

/** The refusals of this package: a stable `code`, and the HTTP status a route would answer. */
export const STORAGE_CODE = {
  badKey: "STORAGE_BAD_KEY",
  badPrefix: "STORAGE_BAD_PREFIX",
  tooBig: "STORAGE_TOO_BIG",
  badType: "STORAGE_BAD_TYPE",
  typeMismatch: "STORAGE_TYPE_MISMATCH",
  provider: "STORAGE_PROVIDER_FAILED",
  badConfig: "STORAGE_BAD_CONFIG",
  badEndpoint: "STORAGE_BAD_ENDPOINT",
  badSecretKey: "STORAGE_BAD_SECRET_KEY",
  unreadable: "STORAGE_UNREADABLE",
  keepingOff: "STORAGE_KEEPING_OFF",
  notFound: "STORAGE_PROVIDER_NOT_FOUND",
  inUse: "STORAGE_PROVIDER_IN_USE",
  notVerified: "STORAGE_PROVIDER_NOT_VERIFIED",
  testFailed: "STORAGE_TEST_FAILED",
  disconnected: "STORAGE_DISCONNECTED",
} as const;
export type StorageCode = (typeof STORAGE_CODE)[keyof typeof STORAGE_CODE];

export class StorageError extends Error {
  constructor(
    readonly code: StorageCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
