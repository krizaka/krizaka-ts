import { bucketStore } from "./bucket-store";
import { cloudConnector, type CloudConnectorName, connectionAccessToken } from "./cloud-connectors";
import { dropboxStore } from "./dropbox-store";
import { checkEndpoint } from "./endpoint";
import { folderStore } from "./folder-store";
import { type ManagedContext, openManaged } from "./managed";
import { type OpendalService, opendalStore } from "./opendal-store";
import { type Clock, type FetchLike, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type FieldSchema, PROVIDER_KINDS, type ProviderKind, type ProviderRuntime } from "./providers";
import { type ResidencyLabel, residencyLabel } from "./regions";
import { remoteStore } from "./remote-store";

export interface OpenContext {
  runtime: ProviderRuntime;
  environment: "dev" | "prod";
  fetch: FetchLike;
  clock: Clock;
  /** A cloud that rotates the refresh token on a refresh hands the new one here, to be sealed again. */
  onRotate?: (refreshToken: string) => Promise<void>;
  /** The `managed` kind only: the tenant keys' table, the audit trail, the mTLS fetch of a KMS that needs one. */
  managed?: ManagedContext;
}

export interface OpenedProvider {
  store: ObjectStore;
  kind: ProviderKind;
  /** Where the files would live, for the screen to show before saving. */
  residency: ResidencyLabel;
  /** The `managed` kind: one encrypted store per tenant, under `t/<tenantId>/`. */
  forTenant?: (tenantId: string) => ObjectStore;
}

/** What an adapter receives: values already checked by the registry (required fields present, `url` fields passed `checkEndpoint`). */
export interface AdapterInput {
  kind: ProviderKind;
  coordinates: Readonly<Record<string, string | undefined>>;
  credentials: Readonly<Record<string, string | undefined>>;
  ctx: OpenContext;
}

export interface OpenedAdapter {
  store: ObjectStore;
  residency: ResidencyLabel;
  forTenant?: (tenantId: string) => ObjectStore;
}

export type ProviderAdapter = (input: AdapterInput) => OpenedAdapter | Promise<OpenedAdapter>;

/** What a private package registers: the kind's data (the same shape as the built-in ones) and the function that opens its store. */
export interface ProviderPlugin {
  kind: ProviderKind;
  open: ProviderAdapter;
}

export interface ProviderRegistry {
  readonly kinds: readonly ProviderKind[];
  kind(name: string): ProviderKind | undefined;
  /**
   * The only factory of stores from a registered kind (ADR-005). It refuses, with `STORAGE_BAD_CONFIG`, a kind that is unknown or has
   * no adapter yet, a kind not allowed in this runtime (`folder` outside `dev`: the web BFF never writes the server's disk), a
   * `devOnly` kind when the environment is `prod`, and a missing field. It never falls back to another kind: a file must not land
   * somewhere nobody expects. These rules apply to every kind, the private ones included.
   */
  open(
    kindName: string,
    coordinates: Readonly<Record<string, string | undefined>>,
    credentials: Readonly<Record<string, string | undefined>>,
    ctx: OpenContext,
  ): Promise<OpenedProvider>;
  /** A new registry with a private kind added. The OSS core is untouched. @throws StorageError `STORAGE_BAD_CONFIG` for a duplicate name or a kind the rules refuse */
  with(plugin: ProviderPlugin): ProviderRegistry;
}

const bad = (message: string) => new StorageError(STORAGE_CODE.badConfig, message);
const KIND_NAME = /^[a-z][a-z0-9-]{1,31}$/;

function need(
  fields: readonly FieldSchema[],
  values: Readonly<Record<string, string | undefined>>,
  what: string,
): void {
  for (const field of fields) if (field.required && !values[field.name]) throw bad(`${what} ${field.name} is not set`);
}

const optional = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> =>
  value ? ({ [key]: value } as Record<K, string>) : {};

const EXTERNAL: ResidencyLabel = {
  key: "elsewhere",
  country: null,
  province: null,
  text: "Elsewhere (no Canadian region checked)",
};
const USER_CLOUD = (name: string): ResidencyLabel => ({
  key: "user-cloud",
  country: null,
  province: null,
  text: `Your own ${name}: we make no claim about where it is`,
});

/** A private kind must obey the rules the built-in ones do: its secrets are `secret` fields (sealed), no secret is a coordinate (shown). */
function assertKind(kind: ProviderKind): void {
  if (!KIND_NAME.test(kind.kind))
    throw bad(`storage kind name « ${kind.kind} » is 2 to 32 lowercase letters, digits or -`);
  for (const field of kind.coordinates)
    if (field.type === "secret")
      throw bad(`${kind.kind}: coordinate ${field.name} is secret and would be shown; make it a credential`);
  for (const field of kind.credentials)
    if (field.type !== "secret")
      throw bad(`${kind.kind}: credential ${field.name} must be a secret field so that it is sealed`);
}

/**
 * Builds a registry from data (`kinds`) and the function that opens each implemented kind (`adapters`, by kind name): the table maps
 * a kind to its adapter, never a branch. Refuses a duplicate kind, an implemented kind without an adapter, an adapter without a kind.
 */
export function createProviderRegistry(input: {
  kinds: readonly ProviderKind[];
  adapters: Readonly<Record<string, ProviderAdapter>>;
}): ProviderRegistry {
  const byName = new Map<string, ProviderKind>();
  for (const kind of input.kinds) {
    if (byName.has(kind.kind)) throw bad(`storage kind ${kind.kind} is registered twice`);
    assertKind(kind);
    byName.set(kind.kind, kind);
    if (kind.implemented && !input.adapters[kind.kind])
      throw bad(`storage kind ${kind.kind} is implemented but has no adapter`);
  }
  for (const name of Object.keys(input.adapters))
    if (!byName.has(name)) throw bad(`an adapter is registered for the unknown kind ${name}`);

  const kind = (name: string) => byName.get(name);
  const registry: ProviderRegistry = {
    kinds: input.kinds,
    kind,
    async open(kindName, coordinates, credentials, ctx) {
      const def = kind(kindName);
      if (!def) throw bad(`unknown storage kind ${kindName}`);
      if (!def.runtimes.includes(ctx.runtime)) throw bad(`${def.kind} cannot be opened by a ${ctx.runtime} runtime`);
      if (def.devOnly && ctx.environment === "prod")
        throw bad(`${def.kind} is for development data only and is refused in production`);
      if (!def.implemented) throw bad(`${def.kind} has no adapter yet`);
      need(def.coordinates, coordinates, "the");
      need(def.credentials, credentials, "the");
      const checked: Record<string, string | undefined> = { ...coordinates };
      for (const field of def.coordinates)
        if (field.type === "url" && coordinates[field.name])
          checked[field.name] = checkEndpoint(
            coordinates[field.name]!,
            ctx.runtime === "dev" ? { allowLocal: true } : {},
          );
      const adapter = input.adapters[def.kind]!;
      return { kind: def, ...(await adapter({ kind: def, coordinates: checked, credentials, ctx })) };
    },
    with(plugin) {
      return createProviderRegistry({
        kinds: [...input.kinds, plugin.kind],
        adapters: { ...input.adapters, ...(plugin.kind.implemented ? { [plugin.kind.kind]: plugin.open } : {}) },
      });
    },
  };
  return registry;
}

/** The OpenDAL kinds that open with static keys: the kind's OpenDAL service, as data. Field names are OpenDAL's own options. */
export const OPENDAL_KEY_KINDS = { azblob: "azblob", gcs: "gcs", b2: "b2", webdav: "webdav" } as const satisfies Record<
  string,
  OpendalService
>;
/** The OpenDAL kinds that open with the person's connection (access token renewed from the sealed refresh token). */
export const OPENDAL_CLOUD_KINDS = { "google-drive": "google-drive", onedrive: "onedrive" } as const satisfies Record<
  string,
  CloudConnectorName
>;
const NOT_OPTIONS = new Set(["prefix"]);

const keyKind =
  (service: OpendalService): ProviderAdapter =>
  async ({ coordinates, credentials, ctx }) => {
    const options: Record<string, string> = {};
    for (const [name, value] of [...Object.entries(coordinates), ...Object.entries(credentials)])
      if (value && !NOT_OPTIONS.has(name) && name !== "encryptionKey") options[name] = value;
    const store = await opendalStore({
      service,
      options,
      ...optional("prefix", coordinates.prefix),
      ...(ctx.runtime === "dev" ? { allowLocal: true } : {}),
    });
    return { store, residency: EXTERNAL };
  };

const cloudKind =
  (connectorName: CloudConnectorName, label: string): ProviderAdapter =>
  async ({ coordinates, credentials, ctx }) => {
    const connector = cloudConnector(connectorName);
    const accessToken = connectionAccessToken({
      connector,
      // A refresh needs no redirect address; the registration is the admin's (client id, and a secret for the clouds that insist).
      app: { clientId: coordinates.clientId!, clientSecret: credentials.clientSecret ?? null, redirectUri: "" },
      refreshToken: credentials.refreshToken!,
      clock: ctx.clock,
      ...(ctx.onRotate ? { onRotate: ctx.onRotate } : {}),
    });
    const store = await opendalStore({
      service: connector.files,
      options: {},
      accessToken,
      ...optional("prefix", coordinates.prefix),
    });
    return { store, residency: USER_CLOUD(label) };
  };

/** The built-in adapters, by kind. */
export const BUILT_IN_ADAPTERS: Readonly<Record<string, ProviderAdapter>> = {
  folder: ({ coordinates }) => ({
    store: folderStore({ root: coordinates.root! }),
    residency: { key: "device", country: null, province: null, text: "This machine (development)" },
  }),
  bunny: ({ coordinates, credentials, ctx }) => ({
    store: remoteStore({
      endpoint: coordinates.endpoint!,
      zone: coordinates.zone!,
      accessKey: credentials.accessKey!,
      ...optional("prefix", coordinates.prefix),
      ...optional("pullHostname", coordinates.pullHostname),
      ...optional("tokenKey", credentials.tokenKey),
      fetch: ctx.fetch,
      clock: ctx.clock,
    }),
    residency: { key: "elsewhere", country: null, province: null, text: "Elsewhere (no Canadian region)" },
  }),
  dropbox: ({ coordinates, credentials, ctx }) => ({
    store: dropboxStore({
      clientId: coordinates.clientId!,
      refreshToken: credentials.refreshToken!,
      ...optional("prefix", coordinates.prefix),
      fetch: ctx.fetch,
      clock: ctx.clock,
    }),
    residency: USER_CLOUD("Dropbox"),
  }),
  s3: ({ coordinates, credentials, ctx }) => ({
    store: bucketStore({
      endpoint: coordinates.endpoint!,
      region: coordinates.region!,
      bucket: coordinates.bucket!,
      accessKeyId: credentials.accessKeyId!,
      secretAccessKey: credentials.secretAccessKey!,
      ...optional("prefix", coordinates.prefix),
      fetch: ctx.fetch,
      clock: ctx.clock,
    }),
    residency: residencyLabel({ provider: "s3", endpoint: coordinates.endpoint!, region: coordinates.region! }),
  }),
  managed: openManaged,
  "google-drive": cloudKind(OPENDAL_CLOUD_KINDS["google-drive"], "Google Drive"),
  onedrive: cloudKind(OPENDAL_CLOUD_KINDS.onedrive, "OneDrive"),
  azblob: keyKind(OPENDAL_KEY_KINDS.azblob),
  gcs: keyKind(OPENDAL_KEY_KINDS.gcs),
  b2: keyKind(OPENDAL_KEY_KINDS.b2),
  webdav: keyKind(OPENDAL_KEY_KINDS.webdav),
};

/** The built-in kinds with their adapters. `defaultProviderRegistry.with(privateKind)` adds a private one. */
export const defaultProviderRegistry: ProviderRegistry = createProviderRegistry({
  kinds: PROVIDER_KINDS,
  adapters: BUILT_IN_ADAPTERS,
});

/** `defaultProviderRegistry.open` (or the registry given): the factory of stores from a registered kind. */
export const openProvider = (
  kindName: string,
  coordinates: Readonly<Record<string, string | undefined>>,
  credentials: Readonly<Record<string, string | undefined>>,
  ctx: OpenContext,
  registry: ProviderRegistry = defaultProviderRegistry,
): Promise<OpenedProvider> => registry.open(kindName, coordinates, credentials, ctx);
