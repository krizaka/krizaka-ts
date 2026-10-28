/**
 * The registry of provider kinds, as data (ADR-005): one entry per kind, never a branch in a factory. A new kind is a line here
 * (and an adapter in `open-provider.ts`); the admin screen, the validation and the guards all read this table. Edge-safe.
 */
export type ProviderKindName = "bunny" | "s3" | "dropbox" | "google-drive" | "onedrive" | "folder" | "device";
export type ProviderScope = "admin" | "user";
/** `server` = a deployed web BFF, `dev` = a developer's machine or CI, `device` = a mobile or macOS client. */
export type ProviderRuntime = "server" | "dev" | "device";

export interface FieldSchema {
  name: string;
  type: "text" | "url" | "host" | "region" | "path" | "secret";
  required: boolean;
}

export interface Preset {
  id: "digitalocean-spaces" | "aws-s3" | "ovhcloud" | "generic";
  /** `{region}` is filled in; `null` for the generic preset (the person types the endpoint). */
  endpointTemplate: string | null;
  /** Regions known to the preset (the region table says where each one is). */
  regions: readonly string[];
}

export interface ProviderKind {
  kind: ProviderKindName;
  scopes: readonly ProviderScope[];
  runtimes: readonly ProviderRuntime[];
  /** Fictional data only: refused when the environment is `prod`. */
  devOnly: boolean;
  /** `false` for a kind that is reserved: declared, with no adapter yet. */
  implemented: boolean;
  capabilities: { private: boolean; signedUrls: boolean; publicUrls: boolean; maxObjectBytes: number; serverSideEncryption: "none" | "provider" | "customer-key" };
  residency: "from-region" | "user-cloud" | "device" | "fixed-elsewhere";
  coordinates: readonly FieldSchema[];
  credentials: readonly FieldSchema[];
  presets?: readonly Preset[];
}

const GIB = 1024 ** 3;
const text = (name: string, required: boolean, type: FieldSchema["type"] = "text"): FieldSchema => ({ name, type, required });
const secret = (name: string, required: boolean): FieldSchema => ({ name, type: "secret", required });

export const S3_PRESETS: readonly Preset[] = [
  { id: "digitalocean-spaces", endpointTemplate: "https://{region}.digitaloceanspaces.com", regions: ["tor1", "nyc3", "sfo3", "ams3", "fra1", "lon1", "sgp1", "blr1", "syd1"] },
  { id: "aws-s3", endpointTemplate: "https://s3.{region}.amazonaws.com", regions: ["ca-central-1", "ca-west-1", "us-east-1", "us-west-2", "eu-west-1"] },
  { id: "ovhcloud", endpointTemplate: "https://s3.{region}.io.cloud.ovh.net", regions: ["bhs", "gra", "sbg", "de", "uk", "waw"] },
  { id: "generic", endpointTemplate: null, regions: [] },
];

/** Dropbox's single-call upload limit is 150 MB; larger files go through upload sessions, up to 350 GB (a ceiling we do not approach). */
const DROPBOX_MAX = 350 * GIB;

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  {
    kind: "bunny",
    scopes: ["admin"],
    runtimes: ["server", "dev"],
    devOnly: true,
    implemented: true,
    capabilities: { private: true, signedUrls: true, publicUrls: true, maxObjectBytes: 5 * GIB, serverSideEncryption: "none" },
    residency: "fixed-elsewhere",
    coordinates: [text("endpoint", true, "host"), text("zone", true), text("pullHostname", false, "host"), text("prefix", false)],
    credentials: [secret("accessKey", true), secret("tokenKey", false)],
  },
  {
    kind: "s3",
    scopes: ["admin", "user"],
    runtimes: ["server", "dev"],
    devOnly: false,
    implemented: true,
    capabilities: { private: true, signedUrls: true, publicUrls: true, maxObjectBytes: 5 * GIB, serverSideEncryption: "provider" },
    residency: "from-region",
    coordinates: [text("endpoint", true, "url"), text("region", true, "region"), text("bucket", true), text("prefix", false)],
    credentials: [secret("accessKeyId", true), secret("secretAccessKey", true)],
    presets: S3_PRESETS,
  },
  {
    kind: "dropbox",
    scopes: ["user"],
    runtimes: ["server"],
    devOnly: false,
    implemented: false,
    // Temporary links live 4 h, longer than our 900 s cap: the app streams the file.
    capabilities: { private: true, signedUrls: false, publicUrls: false, maxObjectBytes: DROPBOX_MAX, serverSideEncryption: "provider" },
    residency: "user-cloud",
    coordinates: [],
    credentials: [secret("refreshToken", true)],
  },
  { kind: "google-drive", scopes: ["user"], runtimes: ["server"], devOnly: false, implemented: false, capabilities: { private: true, signedUrls: false, publicUrls: false, maxObjectBytes: 5 * 1024 * GIB, serverSideEncryption: "provider" }, residency: "user-cloud", coordinates: [], credentials: [secret("refreshToken", true)] },
  { kind: "onedrive", scopes: ["user"], runtimes: ["server"], devOnly: false, implemented: false, capabilities: { private: true, signedUrls: false, publicUrls: false, maxObjectBytes: 250 * GIB, serverSideEncryption: "provider" }, residency: "user-cloud", coordinates: [], credentials: [secret("refreshToken", true)] },
  {
    kind: "folder",
    scopes: [],
    runtimes: ["dev"],
    devOnly: true,
    implemented: true,
    capabilities: { private: true, signedUrls: false, publicUrls: false, maxObjectBytes: 5 * GIB, serverSideEncryption: "none" },
    residency: "device",
    coordinates: [text("root", true, "path")],
    credentials: [],
  },
  {
    kind: "device",
    scopes: [],
    runtimes: ["device"],
    devOnly: false,
    implemented: false,
    capabilities: { private: true, signedUrls: false, publicUrls: false, maxObjectBytes: 5 * GIB, serverSideEncryption: "none" },
    residency: "device",
    coordinates: [],
    credentials: [],
  },
];

export const providerKind = (kind: string): ProviderKind | undefined => PROVIDER_KINDS.find((k) => k.kind === kind);

/** The endpoint a preset gives for a region, or `null` for the generic preset (typed by the person). */
export function presetEndpoint(preset: Preset["id"], region: string): string | null {
  const template = S3_PRESETS.find((p) => p.id === preset)?.endpointTemplate;
  return template ? template.replace("{region}", region) : null;
}
