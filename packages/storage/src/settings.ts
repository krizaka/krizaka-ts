import { choice, integer, type Registry, text } from "@krizaka/settings";

import { bucketStore } from "./bucket-store";
import { checkEndpoint } from "./endpoint";
import { folderStore } from "./folder-store";
import { type Clock, type FetchLike, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { remoteStore } from "./remote-store";
import type { StorageLimits } from "./storage";

export const STORAGE_PROVIDERS = ["local", "http", "s3"] as const;
export const STORAGE_DEFAULTS = { provider: "local", maxMegabytes: 25, signedUrlSeconds: 300 } as const;
const MB = 1024 * 1024;

/**
 * The settings of « storage », a fragment the product adds to its registry (`@krizaka/storage/settings`): the admin picks the provider
 * (`local`, `http` for a Bunny-style zone, `s3` for any S3-compatible bucket) and its non-secret coordinates, without a redeploy.
 * Access keys and the token key stay in the environment and are passed to `storeFromSettings`.
 */
export const storageSettings = {
  "storage.provider": choice("storage", STORAGE_PROVIDERS, STORAGE_DEFAULTS.provider),
  "storage.maxMegabytes": integer("storage", STORAGE_DEFAULTS.maxMegabytes, { min: 1, max: 2048, unit: "MB" }),
  "storage.signedUrlSeconds": integer("storage", STORAGE_DEFAULTS.signedUrlSeconds, { min: 30, max: 86_400, unit: "seconds" }),
  "storage.endpoint": text("storage", "", { empty: true }),
  "storage.region": text("storage", "", { empty: true }),
  "storage.bucket": text("storage", "", { empty: true }),
  "storage.zone": text("storage", "", { empty: true }),
  "storage.prefix": text("storage", "", { empty: true }),
  "storage.pullHostname": text("storage", "", { empty: true }),
  "storage.publicBaseUrl": text("storage", "", { empty: true }),
} as const satisfies Registry;

export interface StorageSettings {
  provider: (typeof STORAGE_PROVIDERS)[number];
  maxMegabytes: number;
  signedUrlSeconds: number;
  endpoint: string;
  region: string;
  bucket: string;
  zone: string;
  prefix: string;
  pullHostname: string;
  publicBaseUrl: string;
}

type Reader = (key: keyof typeof storageSettings) => string | number | undefined | Promise<string | number | undefined>;

/** The module's settings from the product's accessor (`(key) => service.get(key, ctx)`); an unknown key falls back to the default. */
export async function readStorageSettings(read: Reader): Promise<StorageSettings> {
  const str = async (k: keyof typeof storageSettings) => {
    const v = await read(k);
    return typeof v === "string" ? v : "";
  };
  const provider = await read("storage.provider");
  const maxMegabytes = await read("storage.maxMegabytes");
  const signed = await read("storage.signedUrlSeconds");
  return {
    provider: STORAGE_PROVIDERS.find((p) => p === provider) ?? STORAGE_DEFAULTS.provider,
    maxMegabytes: typeof maxMegabytes === "number" ? maxMegabytes : STORAGE_DEFAULTS.maxMegabytes,
    signedUrlSeconds: typeof signed === "number" ? signed : STORAGE_DEFAULTS.signedUrlSeconds,
    endpoint: await str("storage.endpoint"),
    region: await str("storage.region"),
    bucket: await str("storage.bucket"),
    zone: await str("storage.zone"),
    prefix: await str("storage.prefix"),
    pullHostname: await str("storage.pullHostname"),
    publicBaseUrl: await str("storage.publicBaseUrl"),
  };
}

export const limitsOf = (s: StorageSettings): StorageLimits => ({ maxBytes: s.maxMegabytes * MB, signedUrlSeconds: s.signedUrlSeconds });

/** The credentials the product reads from its environment and passes in. */
export interface StorageSecrets {
  accessKeyId?: string;
  secretAccessKey?: string;
  /** The zone's password (`http`). */
  accessKey?: string;
  /** The pull zone's token-authentication key (`http`). */
  tokenKey?: string;
  /** The folder for `local`. */
  root?: string;
}

/**
 * The store the admin chose. A provider chosen without its coordinates or keys is refused loudly, never replaced by another: a file
 * must not land somewhere nobody expects. The `http` endpoint is the host only (`storage.bunnycdn.com`); an `s3` endpoint is checked
 * against our own network (`checkEndpoint`) unless `allowLocalEndpoint` (development).
 * @throws StorageError `STORAGE_BAD_CONFIG` or `STORAGE_BAD_ENDPOINT`
 */
export function storeFromSettings(s: StorageSettings, secrets: StorageSecrets, deps: { fetch: FetchLike; clock: Clock; allowLocalEndpoint?: boolean }): ObjectStore {
  const need = (value: string | undefined, what: string) => {
    if (!value) throw new StorageError(STORAGE_CODE.badConfig, `storage.provider is ${s.provider} but ${what} is not set`);
    return value;
  };
  const optional = <K extends string>(key: K, value: string): Partial<Record<K, string>> => (value === "" ? {} : ({ [key]: value } as Record<K, string>));
  if (s.provider === "local") return folderStore({ root: need(secrets.root, "the folder"), ...optional("publicBaseUrl", s.publicBaseUrl) });
  if (s.provider === "http") {
    const endpoint = need(s.endpoint, "storage.endpoint");
    if (/[/:]/.test(endpoint)) throw new StorageError(STORAGE_CODE.badEndpoint, "the http endpoint is a host name only");
    return remoteStore({ endpoint, zone: need(s.zone, "storage.zone"), accessKey: need(secrets.accessKey, "the zone password"), ...optional("prefix", s.prefix), ...optional("pullHostname", s.pullHostname), ...optional("tokenKey", secrets.tokenKey ?? ""), ...deps });
  }
  return bucketStore({
    endpoint: checkEndpoint(need(s.endpoint, "storage.endpoint"), deps.allowLocalEndpoint ? { allowLocal: true } : {}),
    region: need(s.region, "storage.region"),
    bucket: need(s.bucket, "storage.bucket"),
    accessKeyId: need(secrets.accessKeyId, "the access key id"),
    secretAccessKey: need(secrets.secretAccessKey, "the secret access key"),
    ...optional("prefix", s.prefix),
    ...optional("publicBaseUrl", s.publicBaseUrl),
    ...deps,
  });
}
