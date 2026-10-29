import { type Residency, residencyOfConfig } from "./regions";

/** The two kinds every product shares; the others are the product's. */
export const STORE_KIND = { none: "none", device: "device" } as const;

/** Whose store it is: Krizaka's (the deployment's), the workspace's own, or the person's device. */
export type StoreOwner = "krizaka" | "workspace" | "device";

/** Where objects live, as the product says it: computed from the configuration, never typed. */
export interface StoreDescriptor {
  /** The product's name for the store (`s3`, `bunny`, `database`, `none`, `device`…). */
  kind: string;
  endpoint: string | null;
  region: string | null;
  residency: Residency | "unknown" | "device";
  encrypted: boolean;
  owner: StoreOwner;
  /** For fictional and development data only: the notice says so instead of claiming a place. */
  devOnly: boolean;
}

/** The descriptor of a configured store, from its configuration alone (see `residencyOfConfig`: a Bunny-shaped zone is dev only and never Canadian). */
export function describeStore(
  config: { provider: "http" | "s3"; endpoint: string; region: string },
  options: { encrypted: boolean; owner?: StoreOwner; httpKind?: string },
): StoreDescriptor {
  const owner = options.owner ?? "krizaka";
  if (config.provider === "http")
    return {
      kind: options.httpKind ?? "http",
      endpoint: config.endpoint,
      region: null,
      residency: "elsewhere",
      encrypted: options.encrypted,
      owner,
      devOnly: true,
    };
  return {
    kind: "s3",
    endpoint: new URL(config.endpoint).host,
    region: config.region,
    residency: residencyOfConfig(config),
    encrypted: options.encrypted,
    owner,
    devOnly: false,
  };
}

export interface WhereOptions {
  /** Stores that are not configurable but fixed places (Yomizaka's managed database in Toronto), by kind. */
  fixed?: Readonly<Record<string, StoreDescriptor>>;
  /** Kinds that exist only for development data. */
  devOnly?: readonly string[];
}

/**
 * Where an object lives, from the store kind recorded with it and the store configured now. True at every moment, per object:
 * a fixed place says what it is; `none` and `device` say so; the active store answers for its own kind; any other kind (a store
 * no longer configured) says only its kind, with an unknown residency, so nothing is claimed that nothing proves.
 */
export function where(kind: string, active: StoreDescriptor, options: WhereOptions = {}): StoreDescriptor {
  const fixed = options.fixed?.[kind];
  if (fixed) return fixed;
  if (kind === STORE_KIND.none)
    return { ...active, kind, endpoint: null, region: null, residency: "unknown", encrypted: false, devOnly: false };
  if (kind === STORE_KIND.device)
    return {
      kind,
      endpoint: null,
      region: null,
      residency: "device",
      encrypted: false,
      owner: "device",
      devOnly: false,
    };
  if (kind === active.kind) return active;
  return {
    kind,
    endpoint: null,
    region: null,
    residency: "unknown",
    encrypted: false,
    owner: "krizaka",
    devOnly: options.devOnly?.includes(kind) ?? false,
  };
}

export type NoticeKey =
  "none" | "krizakaCanadaEncrypted" | "krizakaCanada" | "krizakaElsewhere" | "workspace" | "devOnly" | "device";

/** Which sentence says where this object lives (« Not kept », « Kept: Krizaka (Canada, encrypted) »…), with its variables; the product's messages hold the words. */
export function storageNotice(d: StoreDescriptor): { key: NoticeKey; vars: Record<string, string> } {
  if (d.kind === STORE_KIND.none) return { key: "none", vars: {} };
  if (d.kind === STORE_KIND.device) return { key: "device", vars: {} };
  if (d.devOnly) return { key: "devOnly", vars: {} };
  if (d.owner === "workspace")
    return { key: "workspace", vars: { endpoint: d.endpoint ?? "", region: d.region ?? "" } };
  if (d.residency === "canada") return { key: d.encrypted ? "krizakaCanadaEncrypted" : "krizakaCanada", vars: {} };
  return { key: "krizakaElsewhere", vars: { region: d.region ?? "" } };
}
