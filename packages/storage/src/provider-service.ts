import { testConnection } from "./connection-test";
import { checkEndpointDns, type Resolver } from "./dns-check";
import { encryptedStore, parseEncryptionKey } from "./encrypted-store";
import { defaultProviderRegistry, type OpenContext, type ProviderRegistry } from "./open-provider";
import { type Clock, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type LastTest, PROVIDER_STATUS, type ProviderRecord, type ProviderStatus, type ProviderStore } from "./provider-records";
import { type ResidencyLabel } from "./regions";
import { type Keyring, localKeyring, type LocalKeys, openWith, rewrapWith, sealWith } from "./vault";

/** Who acts: recorded in the audit trail. */
export interface Actor {
  id: string | null;
  label: string;
}

/** What the service tells the audit trail (`@krizaka/audit`'s `record`, wired by the product). A secret field reads `changed`, never its value. */
export interface AuditNote {
  actor: Actor;
  action: `storage.${string}`;
  target: { type: "storage_provider"; id: string };
  detail: Record<string, unknown>;
}

export interface ProviderServiceDeps {
  store: ProviderStore;
  /**
   * The key-encryption key: either the in-process key (`MEDIA_VAULT_KEY`, its `key_id`, and the older keys still needed to open
   * values) or any `Keyring` (a KMS). The stored format is the same.
   */
  vault: { keyId: string; key: Uint8Array; ring: LocalKeys } | Keyring;
  /** The provider kinds this service knows; the built-in ones when absent. A private package adds its own with `registry.with(…)`. */
  registry?: ProviderRegistry;
  clock: Clock;
  newId: () => string;
  audit: (note: AuditNote) => Promise<void>;
  /** Opening a store: the runtime, the environment, `fetch` and the clock. */
  open: OpenContext;
  probeId: () => string;
  /** How many objects the product still holds at this provider (it owns the objects table). */
  references: (providerId: string) => Promise<number>;
  resolve?: Resolver;
}

export interface CreateProvider {
  scope: string;
  kind: string;
  preset?: string;
  label: string;
  coordinates: Record<string, string>;
  credentials: Record<string, string>;
}

/** A provider as the API returns it: every secret is `set` or `not set`, nothing else, ever. */
export interface PublicProvider {
  id: string;
  scope: string;
  kind: string;
  preset: string | null;
  label: string;
  coordinates: Record<string, string>;
  credentials: Record<string, "set" | "not set">;
  status: ProviderStatus;
  source: "admin" | "env";
  lastTest: LastTest | null;
  updatedAt: Date;
}

/** Credentials any kind may carry besides its own: the object-encryption key, generated or imported with the provider. */
const COMMON_SECRETS = ["encryptionKey"];

const fail = (code: (typeof STORAGE_CODE)[keyof typeof STORAGE_CODE], message: string) => new StorageError(code, message);

export function createProviderService(deps: ProviderServiceDeps) {
  const keyring: Keyring = "wrap" in deps.vault ? deps.vault : localKeyring(deps.vault);
  const registry = deps.registry ?? defaultProviderRegistry;
  const providerKind = registry.kind;
  const credentialsOf = async (record: ProviderRecord): Promise<Record<string, string>> => JSON.parse(await openWith(keyring, record.sealedCredentials)) as Record<string, string>;
  const seal = (credentials: Record<string, string>) => sealWith(keyring, JSON.stringify(credentials));

  /** A cloud that rotates its refresh token hands the new one back: sealed again under the current key, the rest untouched. */
  const reseal = (record: ProviderRecord) => async (refreshToken: string) => {
    const credentials = { ...(await credentialsOf(record)), refreshToken };
    await deps.store.update(record.id, { sealedCredentials: await seal(credentials), keyId: keyring.keyId, updatedAt: deps.clock.now() });
  };

  const must = async (id: string): Promise<ProviderRecord> => {
    const record = await deps.store.get(id);
    if (!record) throw fail(STORAGE_CODE.notFound, "No such storage provider");
    return record;
  };

  const publicOf = async (r: ProviderRecord): Promise<PublicProvider> => {
    const fields = [...(providerKind(r.kind)?.credentials.map((f) => f.name) ?? []), ...COMMON_SECRETS];
    const have = await credentialsOf(r);
    return { id: r.id, scope: r.scope, kind: r.kind, preset: r.preset, label: r.label, coordinates: r.coordinates, credentials: Object.fromEntries(fields.map((f) => [f, have[f] ? "set" : "not set"] as const)), status: r.status, source: r.source, lastTest: r.lastTest, updatedAt: r.updatedAt };
  };

  const validate = (input: Pick<CreateProvider, "scope" | "kind" | "coordinates" | "credentials">) => {
    const kind = providerKind(input.kind);
    if (!kind) throw fail(STORAGE_CODE.badConfig, `unknown storage kind ${input.kind}`);
    const scope = input.scope === "org" ? "admin" : "user";
    if (!kind.scopes.includes(scope)) throw fail(STORAGE_CODE.badConfig, `${kind.kind} cannot be configured at ${input.scope} scope`);
    const known = (fields: readonly { name: string }[], extra: string[], given: Record<string, string>, what: string) => {
      for (const name of Object.keys(given)) if (!fields.some((f) => f.name === name) && !extra.includes(name)) throw fail(STORAGE_CODE.badConfig, `${what} ${name} is not a field of ${kind.kind}`);
    };
    known(kind.coordinates, [], input.coordinates, "coordinate");
    known(kind.credentials, COMMON_SECRETS, input.credentials, "credential");
    return kind;
  };

  const attempt = async (record: ProviderRecord, credentials: Record<string, string>): Promise<{ test: LastTest; store: ObjectStore | null }> => {
    const now = deps.clock.now();
    const failed = (message: string, residency: ResidencyLabel): { test: LastTest; store: null } => ({ test: { ok: false, at: now, steps: [{ name: "open", ok: false, ms: 0, error: message }], residency }, store: null });
    const unknown: ResidencyLabel = { key: "unknown", country: null, province: null, text: "Unknown" };
    try {
      if (providerKind(record.kind)?.presets && deps.open.runtime !== "dev") await checkEndpointDns(record.coordinates.endpoint ?? "", { ...(deps.resolve ? { resolve: deps.resolve } : {}) });
      const opened = await registry.open(record.kind, record.coordinates, credentials, { ...deps.open, onRotate: reseal(record) });
      const store = credentials.encryptionKey ? encryptedStore(opened.store, parseEncryptionKey(credentials.encryptionKey)) : opened.store;
      const out = await testConnection(store, deps.probeId(), () => deps.clock.now().getTime());
      return { test: { ok: out.ok, at: now, steps: out.steps, residency: opened.residency }, store };
    } catch (error) {
      return failed(error instanceof Error ? error.message.slice(0, 160) : "failed", unknown);
    }
  };

  const note = (actor: Actor, action: AuditNote["action"], id: string, detail: Record<string, unknown>) => deps.audit({ actor, action, target: { type: "storage_provider", id }, detail });

  return {
    /** Adds a provider as a `draft`: nothing is used until a test is green and it is made a default. Secrets are sealed under the vault key. */
    async create(actor: Actor, input: CreateProvider): Promise<PublicProvider> {
      validate(input);
      const now = deps.clock.now();
      const record: ProviderRecord = { id: deps.newId(), scope: input.scope, kind: input.kind, preset: input.preset ?? null, label: input.label, coordinates: input.coordinates, sealedCredentials: await seal(input.credentials), keyId: keyring.keyId, status: "draft", source: "admin", lastTest: null, createdBy: actor.id, createdAt: now, updatedAt: now };
      await deps.store.insert(record);
      await note(actor, "storage.provider_created", record.id, { kind: record.kind, preset: record.preset, label: record.label, scope: record.scope, coordinates: record.coordinates, credentials: Object.fromEntries(Object.keys(input.credentials).map((k) => [k, "changed"])) });
      return publicOf(record);
    },

    /** Tests the provider (endpoint DNS, then a probe write, read, delete). Only a green test moves a draft to verified. */
    async test(actor: Actor, id: string): Promise<PublicProvider> {
      const record = await must(id);
      const { test } = await attempt(record, await credentialsOf(record));
      const status = test.ok && record.status === PROVIDER_STATUS.draft ? PROVIDER_STATUS.verified : record.status;
      const next = (await deps.store.update(id, { lastTest: test, status, updatedAt: deps.clock.now() }))!;
      await note(actor, "storage.provider_tested", id, { ok: test.ok, residency: test.residency.key, steps: test.steps.map((s) => ({ name: s.name, ok: s.ok })) });
      return publicOf(next);
    },

    /** Makes a verified provider the default for a kind of data: new writes go there; the previous default keeps reading (`retiring`). */
    async setDefault(actor: Actor, id: string, scope: string, dataKind: string): Promise<PublicProvider> {
      const record = await must(id);
      if (record.status !== PROVIDER_STATUS.verified && record.status !== PROVIDER_STATUS.active) throw fail(STORAGE_CODE.notVerified, "Only a verified provider can become a default: test it first");
      if (record.scope !== scope) throw fail(STORAGE_CODE.badConfig, "The provider belongs to another scope");
      const previousId = await deps.store.defaultFor(scope, dataKind);
      await deps.store.setDefault(scope, dataKind, id);
      const now = deps.clock.now();
      const next = (await deps.store.update(id, { status: "active", updatedAt: now }))!;
      if (previousId && previousId !== id) {
        const stillDefault = Object.values(await deps.store.defaults(scope)).includes(previousId);
        if (!stillDefault) await deps.store.update(previousId, { status: "retiring", updatedAt: now });
      }
      await note(actor, "storage.default_set", id, { scope, dataKind, previous: previousId });
      return publicOf(next);
    },

    /** Replaces the credentials. The candidate is tested first; a failing one is refused and nothing is saved. */
    async changeKey(actor: Actor, id: string, credentials: Record<string, string>): Promise<PublicProvider> {
      const record = await must(id);
      validate({ scope: record.scope, kind: record.kind, coordinates: record.coordinates, credentials });
      const merged = { ...(await credentialsOf(record)), ...credentials };
      const { test } = await attempt(record, merged);
      if (!test.ok) throw fail(STORAGE_CODE.testFailed, "The new key failed the connection test: nothing was saved");
      const next = (await deps.store.update(id, { sealedCredentials: await seal(merged), keyId: keyring.keyId, lastTest: test, updatedAt: deps.clock.now() }))!;
      await note(actor, "storage.key_changed", id, { credentials: Object.fromEntries(Object.keys(credentials).map((k) => [k, "changed"])) });
      return publicOf(next);
    },

    /** Disables a provider. Refused while it is a default or while objects still reach it. */
    async disable(actor: Actor, id: string): Promise<PublicProvider> {
      const record = await must(id);
      const used = Object.values(await deps.store.defaults(record.scope)).includes(id);
      if (used || (await deps.references(id)) > 0) throw fail(STORAGE_CODE.inUse, "The provider is a default or objects still reach it");
      const next = (await deps.store.update(id, { status: "disabled", updatedAt: deps.clock.now() }))!;
      await note(actor, "storage.provider_disabled", id, { from: record.status });
      return publicOf(next);
    },

    /** The admin's confirmation that a `retiring` provider is done: no object reaches it, its old copies are swept, it is disabled. */
    async retire(actor: Actor, id: string): Promise<{ provider: PublicProvider; swept: number }> {
      const record = await must(id);
      if (record.status !== PROVIDER_STATUS.retiring) throw fail(STORAGE_CODE.badConfig, "Only a retiring provider is retired");
      if ((await deps.references(id)) > 0) throw fail(STORAGE_CODE.inUse, "Objects still reach this provider: finish the move first");
      const opened = await this.open(id);
      let swept = 0;
      for (const object of await opened.list("")) {
        await opened.delete(object.key);
        swept += 1;
      }
      const next = (await deps.store.update(id, { status: "disabled", updatedAt: deps.clock.now() }))!;
      await note(actor, "storage.provider_retired", id, { swept });
      return { provider: await publicOf(next), swept };
    },

    async list(scope?: string): Promise<PublicProvider[]> {
      return Promise.all((await deps.store.list(scope)).map(publicOf));
    },

    /** The store of a provider, encrypted when it carries an object key. The one place credentials are opened. */
    async open(id: string): Promise<ObjectStore> {
      const record = await must(id);
      if (record.status === PROVIDER_STATUS.disabled || record.status === PROVIDER_STATUS.draft) throw fail(STORAGE_CODE.notVerified, "This provider is not usable");
      const credentials = await credentialsOf(record);
      const opened = await registry.open(record.kind, record.coordinates, credentials, { ...deps.open, onRotate: reseal(record) });
      return credentials.encryptionKey ? encryptedStore(opened.store, parseEncryptionKey(credentials.encryptionKey)) : opened.store;
    },

    /** The store of the default provider of a kind of data, or `null` when none is set (nothing is kept: ADR-0012). */
    async openDefault(scope: string, dataKind: string): Promise<{ id: string; store: ObjectStore } | null> {
      const id = await deps.store.defaultFor(scope, dataKind);
      return id ? { id, store: await this.open(id) } : null;
    },

    /**
     * The environment only bootstraps: when the database holds no provider and the environment carries the old coordinates, they are
     * imported once as an `active` provider (`source: env`), audited, and the environment chooses nothing afterwards.
     * @returns the new provider, or `null` when the database already has providers or the environment names none
     */
    async bootstrap(env: { kind: string; coordinates: Record<string, string>; credentials: Record<string, string>; label: string; dataKinds: readonly string[] } | null): Promise<PublicProvider | null> {
      if (!env || (await deps.store.list()).length > 0) return null;
      validate({ scope: "org", kind: env.kind, coordinates: env.coordinates, credentials: env.credentials });
      const now = deps.clock.now();
      const record: ProviderRecord = { id: deps.newId(), scope: "org", kind: env.kind, preset: null, label: env.label, coordinates: env.coordinates, sealedCredentials: await seal(env.credentials), keyId: keyring.keyId, status: "active", source: "env", lastTest: null, createdBy: null, createdAt: now, updatedAt: now };
      await deps.store.insert(record);
      for (const dataKind of env.dataKinds) await deps.store.setDefault("org", dataKind, record.id);
      await note({ id: null, label: "system" }, "storage.provider_imported", record.id, { kind: record.kind, source: "env", dataKinds: env.dataKinds, credentials: Object.fromEntries(Object.keys(env.credentials).map((k) => [k, "changed"])) });
      return publicOf(record);
    },

    /** Re-wraps every data key under a new key-encryption key (the rotation). No credential is retyped. */
    async rotateVaultKey(actor: Actor): Promise<number> {
      let rewrapped = 0;
      for (const record of await deps.store.list()) {
        if (record.keyId === keyring.keyId) continue;
        await deps.store.update(record.id, { sealedCredentials: await rewrapWith(keyring, record.sealedCredentials), keyId: keyring.keyId });
        rewrapped += 1;
      }
      if (rewrapped > 0) await note(actor, "storage.vault_rotated", "vault", { rewrapped, keyId: keyring.keyId });
      return rewrapped;
    },
  };
}

export type ProviderService = ReturnType<typeof createProviderService>;
