import { bucketStore } from "./bucket-store";
import { checkEndpoint } from "./endpoint";
import { folderStore } from "./folder-store";
import { type Clock, type FetchLike, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type FieldSchema, type ProviderKind, providerKind, type ProviderRuntime } from "./providers";
import { type ResidencyLabel, residencyLabel } from "./regions";
import { remoteStore } from "./remote-store";

export interface OpenContext {
  runtime: ProviderRuntime;
  environment: "dev" | "prod";
  fetch: FetchLike;
  clock: Clock;
}

export interface OpenedProvider {
  store: ObjectStore;
  kind: ProviderKind;
  /** Where the files would live, for the screen to show before saving. */
  residency: ResidencyLabel;
}

const bad = (message: string) => new StorageError(STORAGE_CODE.badConfig, message);

function need(fields: readonly FieldSchema[], values: Readonly<Record<string, string | undefined>>, what: string): void {
  for (const field of fields) if (field.required && !values[field.name]) throw bad(`${what} ${field.name} is not set`);
}

const optional = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> => (value ? ({ [key]: value } as Record<K, string>) : {});

/**
 * The only factory of stores from a registered kind (ADR-005). It refuses, with `STORAGE_BAD_CONFIG`, a kind that is unknown or has
 * no adapter yet, a kind not allowed in this runtime (`folder` outside `dev`: the web BFF never writes the server's disk), a
 * `devOnly` kind when the environment is `prod`, and a missing field. It never falls back to another kind: a file must not land
 * somewhere nobody expects.
 */
export function openProvider(kindName: string, coordinates: Readonly<Record<string, string | undefined>>, credentials: Readonly<Record<string, string | undefined>>, ctx: OpenContext): OpenedProvider {
  const kind = providerKind(kindName);
  if (!kind) throw bad(`unknown storage kind ${kindName}`);
  if (!kind.runtimes.includes(ctx.runtime)) throw bad(`${kind.kind} cannot be opened by a ${ctx.runtime} runtime`);
  if (kind.devOnly && ctx.environment === "prod") throw bad(`${kind.kind} is for development data only and is refused in production`);
  if (!kind.implemented) throw bad(`${kind.kind} has no adapter yet`);
  need(kind.coordinates, coordinates, "the");
  need(kind.credentials, credentials, "the");
  const deps = { fetch: ctx.fetch, clock: ctx.clock };
  if (kindName === "folder") return { store: folderStore({ root: coordinates.root! }), kind, residency: { key: "device", country: null, province: null, text: "This machine (development)" } };
  if (kindName === "bunny") {
    const store = remoteStore({ endpoint: coordinates.endpoint!, zone: coordinates.zone!, accessKey: credentials.accessKey!, ...optional("prefix", coordinates.prefix), ...optional("pullHostname", coordinates.pullHostname), ...optional("tokenKey", credentials.tokenKey), ...deps });
    return { store, kind, residency: { key: "elsewhere", country: null, province: null, text: "Elsewhere (no Canadian region)" } };
  }
  const endpoint = checkEndpoint(coordinates.endpoint!, ctx.runtime === "dev" ? { allowLocal: true } : {});
  const store = bucketStore({ endpoint, region: coordinates.region!, bucket: coordinates.bucket!, accessKeyId: credentials.accessKeyId!, secretAccessKey: credentials.secretAccessKey!, ...optional("prefix", coordinates.prefix), ...deps });
  return { store, kind, residency: residencyLabel({ provider: "s3", endpoint, region: coordinates.region! }) };
}
