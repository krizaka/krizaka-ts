import { encryptedStore, parseEncryptionKey } from "./encrypted-store";
import { type Clock, type FetchLike, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type StorageSettings, storeFromSettings } from "./settings";
import { describeStore, type StoreDescriptor } from "./where";

/**
 * What a deployment's environment says about one kind of kept data (documents, avatars, exports…), read by the product's edge and
 * passed in: this module reads no environment. `provider: "none"` is « keeping is off here ».
 */
export interface DeploymentStorage {
  environment: "dev" | "prod";
  provider: "none" | "http" | "s3";
  prefix?: string;
  /** 32 bytes in base64: when set, everything is encrypted before it leaves. */
  encryptionKey?: string;
  http?: { endpoint?: string; zone?: string; accessKey?: string; pullHostname?: string; tokenKey?: string };
  s3?: { endpoint?: string; region?: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string };
}

/** A signed link never lives longer than this, whatever the admin or a caller asks (a kept file is personal data). */
// @fixed: a link to personal data that outlives a reading session is a leak
export const DEFAULT_MAX_SIGNED_SECONDS = 900;

export type ResolvedStorage = { provider: "none" } | { provider: "http" | "s3"; settings: StorageSettings; secrets: { accessKeyId?: string; secretAccessKey?: string; accessKey?: string; tokenKey?: string }; descriptor: StoreDescriptor };

/**
 * The provider that applies to a kind of data, from the admin's settings over the deployment's environment. The same function serves
 * every kind (documents, avatars): the admin's choice in `storage.*` wins for each, the environment supplies the secrets and the
 * fallback when the admin left `local`.
 *
 * The environment can switch keeping off (`provider: "none"`), and the admin cannot override that: an admin who picks `http` or `s3`
 * while the environment says `none` is refused with `STORAGE_KEEPING_OFF`, never silently ignored (the screen would say « kept »
 * while nothing is) and never silently turned on (a deployment that was told not to keep files would start to). Changing the
 * environment is the way to turn keeping on. Call this when saving the settings to refuse early, and again to open the store.
 * @throws StorageError `STORAGE_KEEPING_OFF`
 */
export function resolveStorage(env: DeploymentStorage, admin: StorageSettings | null, options: { maxSignedSeconds?: number } = {}): ResolvedStorage {
  const adminProvider = admin && admin.provider !== "local" ? admin.provider : null;
  if (env.provider === "none") {
    if (adminProvider) throw new StorageError(STORAGE_CODE.keepingOff, `The admin chose storage.provider ${adminProvider}, but this deployment has keeping turned off (provider none): turn it on in the environment first`);
    return { provider: "none" };
  }
  const provider = adminProvider ?? env.provider;
  const pick = (own: string | undefined, fallback: string | undefined) => (own ? own : (fallback ?? ""));
  const http = provider === "http";
  const settings: StorageSettings = {
    provider,
    maxMegabytes: admin?.maxMegabytes ?? 25, // @fixed: the settings default, the admin changes it
    signedUrlSeconds: Math.min(admin?.signedUrlSeconds ?? Infinity, options.maxSignedSeconds ?? DEFAULT_MAX_SIGNED_SECONDS),
    endpoint: http ? pick(admin?.endpoint, env.http?.endpoint) : pick(admin?.endpoint, env.s3?.endpoint),
    region: pick(admin?.region, env.s3?.region),
    bucket: pick(admin?.bucket, env.s3?.bucket),
    zone: pick(admin?.zone, env.http?.zone),
    prefix: pick(admin?.prefix, env.prefix),
    pullHostname: pick(admin?.pullHostname, env.http?.pullHostname),
    publicBaseUrl: admin?.publicBaseUrl ?? "",
  };
  const secrets = { ...env.s3, ...env.http };
  return { provider, settings, secrets: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey, accessKey: secrets.accessKey, tokenKey: secrets.tokenKey }, descriptor: describeStore({ provider, endpoint: settings.endpoint, region: settings.region }, { encrypted: !!env.encryptionKey }) };
}

/**
 * The store of a resolved configuration, encrypted when the environment holds a key, with the descriptor the product says. `null` when
 * keeping is off. A provider without its coordinates or keys is refused (`STORAGE_BAD_CONFIG`), never replaced by another.
 */
export function openResolved(resolved: ResolvedStorage, env: DeploymentStorage, deps: { fetch: FetchLike; clock: Clock }): { store: ObjectStore; descriptor: StoreDescriptor } | null {
  if (resolved.provider === "none") return null;
  const objects = storeFromSettings(resolved.settings, resolved.secrets, { ...deps, allowLocalEndpoint: env.environment === "dev" });
  const store = env.encryptionKey ? encryptedStore(objects, parseEncryptionKey(env.encryptionKey)) : objects;
  return { store, descriptor: resolved.descriptor };
}
