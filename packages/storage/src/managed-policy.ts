import { choice, flag, integer, type Registry, WORKSPACE_SCOPES } from "@krizaka/settings";

import { STORAGE_CODE, StorageError } from "./port";

/**
 * The administrator's controls of the managed storage (ADR-020 Decision 7), as settings in the database: off until switched on,
 * resolved **tenant > plan > product > global**. The tenant is the settings' workspace scope and the product the product's own global
 * value; the plan layer is data the product passes (its offer), never a branch. Every change goes through `@krizaka/settings`, which
 * audits it. Bring-your-own stays the default.
 */
export const MANAGED_ALLOWED = ["byo", "managed", "both"] as const;
export type ManagedAllowed = (typeof MANAGED_ALLOWED)[number];

export interface ManagedPolicy {
  /** The managed service is on for this tenant. */
  managed: boolean;
  /** Which providers a tenant may pick. */
  allowed: ManagedAllowed;
  quotaGigabytes: number;
  /** The longest a share link may live. */
  maxLinkHours: number;
  privateFolders: boolean;
  deviceCacheMegabytes: number;
  /** Deleted items stay in the trash this long, then every version goes. */
  trashDays: number;
  /** The bounds within which a tenant chooses its retention. */
  retentionMinDays: number;
  retentionMaxDays: number;
}

export type PolicyLayer = Partial<ManagedPolicy>;

export const MANAGED_DEFAULTS: ManagedPolicy = {
  managed: false,
  allowed: "byo",
  quotaGigabytes: 5,
  maxLinkHours: 168,
  privateFolders: false,
  deviceCacheMegabytes: 512,
  trashDays: 30,
  retentionMinDays: 0,
  retentionMaxDays: 3650,
};

/** The registry fragment (`@krizaka/storage/settings`): global and per tenant (workspace), each change audited by the settings service. */
export const managedStorageSettings = {
  "storage.managed.enabled": flag("storage", MANAGED_DEFAULTS.managed, WORKSPACE_SCOPES),
  "storage.managed.allowed": choice("storage", MANAGED_ALLOWED, MANAGED_DEFAULTS.allowed, WORKSPACE_SCOPES),
  "storage.managed.quotaGigabytes": integer(
    "storage",
    MANAGED_DEFAULTS.quotaGigabytes,
    { min: 0, max: 100_000, unit: "GB" },
    WORKSPACE_SCOPES,
  ),
  "storage.managed.maxLinkHours": integer(
    "storage",
    MANAGED_DEFAULTS.maxLinkHours,
    { min: 1, max: 8760, unit: "hours" },
    WORKSPACE_SCOPES,
  ),
  "storage.managed.privateFolders": flag("storage", MANAGED_DEFAULTS.privateFolders, WORKSPACE_SCOPES),
  "storage.managed.deviceCacheMegabytes": integer(
    "storage",
    MANAGED_DEFAULTS.deviceCacheMegabytes,
    { min: 0, max: 1_048_576, unit: "MB" },
    WORKSPACE_SCOPES,
  ),
  "storage.managed.trashDays": integer(
    "storage",
    MANAGED_DEFAULTS.trashDays,
    { min: 0, max: 365, unit: "days" },
    WORKSPACE_SCOPES,
  ),
  "storage.managed.retentionMinDays": integer("storage", MANAGED_DEFAULTS.retentionMinDays, {
    min: 0,
    max: 36_500,
    unit: "days",
  }),
  "storage.managed.retentionMaxDays": integer("storage", MANAGED_DEFAULTS.retentionMaxDays, {
    min: 0,
    max: 36_500,
    unit: "days",
  }),
} as const satisfies Registry;

const defined = (layer: PolicyLayer | undefined): PolicyLayer =>
  Object.fromEntries(Object.entries(layer ?? {}).filter(([, v]) => v !== undefined));

/**
 * One tenant's policy: each field from the most specific layer that sets it. A policy that contradicts itself is refused, never
 * repaired: the admin screen shows the error.
 * @throws StorageError `STORAGE_BAD_CONFIG` (retention bounds reversed, a trash longer than the retention allows)
 */
export function resolveManagedPolicy(layers: {
  global?: PolicyLayer;
  product?: PolicyLayer;
  plan?: PolicyLayer;
  tenant?: PolicyLayer;
}): ManagedPolicy {
  const policy: ManagedPolicy = {
    ...MANAGED_DEFAULTS,
    ...defined(layers.global),
    ...defined(layers.product),
    ...defined(layers.plan),
    ...defined(layers.tenant),
  };
  if (policy.retentionMinDays > policy.retentionMaxDays)
    throw new StorageError(STORAGE_CODE.badConfig, "The retention minimum is above its maximum");
  if (policy.trashDays > policy.retentionMaxDays)
    throw new StorageError(STORAGE_CODE.badConfig, "The trash outlives the longest retention");
  return policy;
}

const MANAGED_KINDS = new Set(["managed"]);

/** Whether this tenant may store on a provider of `kind`: the managed one only when switched on and allowed; BYO kinds per `allowed`. */
export function providerAllowed(policy: ManagedPolicy, kind: string): boolean {
  const managed = MANAGED_KINDS.has(kind);
  if (managed) return policy.managed && policy.allowed !== MANAGED_ALLOWED[0];
  return policy.allowed !== MANAGED_ALLOWED[1] || !policy.managed;
}

/** A link lifetime the policy allows, in seconds. @throws StorageError `STORAGE_BAD_CONFIG` above the maximum */
export function linkSeconds(policy: ManagedPolicy, requestedSeconds: number): number {
  if (requestedSeconds <= 0 || requestedSeconds > policy.maxLinkHours * 3600)
    throw new StorageError(STORAGE_CODE.badConfig, `A link lives at most ${policy.maxLinkHours} hours here`);
  return requestedSeconds;
}

/**
 * The entries of the price catalogue the managed storage reads (ADR-009: prices are data). The amounts are set by the owner in the
 * catalogue; none is typed here. Public pages read the catalogue; BYOK and the dedicated bucket belong to the Entreprise offer.
 */
export const MANAGED_PRICE_IDS = {
  quota: "storage.managed.quota",
  overage: "storage.managed.overage",
  byok: "storage.managed.byok",
  dedicatedBucket: "storage.managed.dedicated-bucket",
} as const;
