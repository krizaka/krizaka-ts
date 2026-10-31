import { bucketStore } from "./bucket-store";
import { type CloudKeyConfig, cloudKeyService } from "./cloud-keys";
import { type KeyService, memoryKeyService } from "./key-service";
import { type Clock, type FetchLike, type ObjectStore, STORAGE_CODE, StorageError } from "./port";
import { type ResidencyLabel, residencyLabel } from "./regions";
import type { TenantKeyStore } from "./tenant-keys";
import { type KeyAuditNote, tenantStore, tenantVault } from "./tenant-vault";

/**
 * The managed provider (ADR-020): Krizaka's own storage, offered as one more provider kind. Any S3-compatible bucket (OVHcloud,
 * AWS, Google Cloud Storage in interoperability mode, DigitalOcean Spaces, a local S3 server in development) plus a KMS (`okms`,
 * `aws-kms`, or `local` in development), all entered by the administrator in the provider screen: coordinates in clear, keys sealed
 * by the provider service and never shown back. Each tenant gets its own `ObjectStore` under `t/<tenantId>/`, encrypted per tenant.
 * Switching provider is the move job (`moveBatch`) between two of these, or from a tenant's own bucket: no data is lost, no code changes.
 */
export const MANAGED_KMS = ["okms", "aws-kms", "local"] as const;
export type ManagedKms = (typeof MANAGED_KMS)[number];

/** What a product passes to open the managed kind: the tenant keys' table, the audit trail, and how to reach an mTLS KMS. */
export interface ManagedContext {
  keys: TenantKeyStore;
  audit: (note: KeyAuditNote) => Promise<void>;
  /** OKMS authenticates by client certificate: the product builds a `fetch` that carries it (an undici agent). */
  mtlsFetch?: (identity: { certificate: string; privateKey: string }) => FetchLike;
}

/** The tenant the connection test writes under: proves bucket, KMS and key table end to end. */
export const PROBE_TENANT = "krizaka-connection-test";

const bad = (why: string) => new StorageError(STORAGE_CODE.badConfig, why);

type Fields = Readonly<Record<string, string | undefined>>;

/** What the registry hands the adapter (the shape of `AdapterInput`, declared here so the registry imports this module, not the reverse). */
export interface ManagedInput {
  coordinates: Fields;
  credentials: Fields;
  ctx: { environment: "dev" | "prod"; fetch: FetchLike; clock: Clock; managed?: ManagedContext };
}

const KMS_OPENERS: Record<ManagedKms, (input: ManagedInput, managed: ManagedContext) => KeyService> = {
  local({ credentials, ctx }) {
    if (ctx.environment === "prod") throw bad("the local KMS holds its root key in memory: refused in production");
    const root = credentials.localRootKey ? new Uint8Array(Buffer.from(credentials.localRootKey, "base64")) : undefined;
    return memoryKeyService(root ? { name: "local", root } : { name: "local" });
  },
  "aws-kms"({ coordinates: c, credentials: s, ctx }) {
    const config: CloudKeyConfig = {
      kind: "aws-kms",
      region: need(c.kmsRegion ?? c.region, "kmsRegion"),
      keyId: need(c.kmsKeyId, "kmsKeyId"),
      accessKeyId: need(s.kmsAccessKeyId, "kmsAccessKeyId"),
      secretAccessKey: need(s.kmsSecretAccessKey, "kmsSecretAccessKey"),
      ...(c.kmsEndpoint ? { endpoint: c.kmsEndpoint } : {}),
    };
    return cloudKeyService(config, { fetch: ctx.fetch, clock: ctx.clock });
  },
  okms({ coordinates: c, credentials: s, ctx }, managed) {
    if (!managed.mtlsFetch) throw bad("okms needs the product's mTLS fetch (ManagedContext.mtlsFetch)");
    const fetch = managed.mtlsFetch({
      certificate: need(s.kmsCertificate, "kmsCertificate"),
      privateKey: need(s.kmsPrivateKey, "kmsPrivateKey"),
    });
    const config: CloudKeyConfig = {
      kind: "okms",
      endpoint: need(c.kmsEndpoint, "kmsEndpoint"),
      okmsId: need(c.okmsId, "okmsId"),
      keyId: need(c.kmsKeyId, "kmsKeyId"),
    };
    return cloudKeyService(config, { fetch, clock: ctx.clock });
  },
};

function need(value: string | undefined, name: string): string {
  if (!value) throw bad(`the managed provider needs ${name}`);
  return value;
}

/** « Canada (Québec) », or « Canada (Québec); replica: Canada (Ontario) » when the admin declared the replica. */
export function managedResidency(c: Fields): ResidencyLabel & { replica: ResidencyLabel | null } {
  const primary = residencyLabel({ provider: "s3", endpoint: c.endpoint!, region: c.region! });
  if (!c.replicaRegion || !c.replicaEndpoint) return { ...primary, replica: null };
  const replica = residencyLabel({ provider: "s3", endpoint: c.replicaEndpoint, region: c.replicaRegion });
  return { ...primary, text: `${primary.text}; replica: ${replica.text}`, replica };
}

/** The adapter of the `managed` kind: the bucket, the KMS, and one encrypted store per tenant. */
export function openManaged(input: ManagedInput): {
  store: ObjectStore;
  residency: ResidencyLabel;
  forTenant(tenantId: string): ObjectStore;
} {
  const managed = input.ctx.managed;
  if (!managed) throw bad("the managed provider needs OpenContext.managed (the tenant keys and the audit)");
  const kms = input.coordinates.kms;
  const opener = MANAGED_KMS.find((k) => k === kms);
  if (!opener) throw bad(`kms is one of ${MANAGED_KMS.join(", ")}`);
  const { coordinates: c, credentials: s, ctx } = input;
  const bucket = bucketStore({
    endpoint: c.endpoint!,
    region: c.region!,
    bucket: c.bucket!,
    accessKeyId: s.accessKeyId!,
    secretAccessKey: s.secretAccessKey!,
    fetch: ctx.fetch,
    clock: ctx.clock,
  });
  const vault = tenantVault({
    kms: KMS_OPENERS[opener](input, managed),
    keys: managed.keys,
    clock: ctx.clock,
    audit: managed.audit,
  });
  const forTenant = (tenantId: string) => tenantStore(bucket, vault, tenantId);
  return { store: forTenant(PROBE_TENANT), residency: managedResidency(c), forTenant };
}
