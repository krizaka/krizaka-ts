/**
 * The default entry: safe on Edge and in the browser (no `node:` import, nothing that reads a file). Types and the port, the region
 * table, the residency and « where are my files » texts, the endpoint check, the type sniffer, the keys rules and the in-memory store.
 * Everything that hashes, signs, encrypts or touches the disk is in `@krizaka/storage/node` (the `node` condition of `.` too).
 */
export { testConnection, type TestStep } from "./connection-test";
export { checkEndpoint } from "./endpoint";
export { assertKey, defineLayout, type Layout, trimSlashes, typeOfName } from "./keys";
export { memoryObjectStore } from "./memory-store";
export * from "./port";
export {
  type FieldSchema,
  type Preset,
  presetEndpoint,
  PROVIDER_KINDS,
  type ProviderKind,
  providerKind,
  type ProviderKindName,
  type ProviderRuntime,
  type ProviderScope,
  S3_PRESETS,
} from "./providers";
export { readUpload, type ReadUploadOptions, type ReadUploadResult } from "./read-upload";
export {
  COUNTRY_OF_REGION,
  countryOf,
  type Province,
  PROVINCE_OF_REGION,
  provinceOf,
  type Residency,
  type ResidencyLabel,
  residencyLabel,
  residencyOf,
  residencyOfConfig,
} from "./regions";
export { sniffType } from "./sniff";
export { type SweepOptions, sweepOrphans, type SweepResult } from "./sweep";
export {
  describeStore,
  type NoticeKey,
  storageNotice,
  STORE_KIND,
  type StoreDescriptor,
  type StoreOwner,
  where,
  type WhereOptions,
} from "./where";
