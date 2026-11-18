/**
 * The default entry: safe on Edge and in the browser (no `node:` import, nothing that reads a file). Types and the port, the region
 * table, the residency and « where are my files » texts, the endpoint check, the type sniffer, the keys rules and the in-memory store.
 * Everything that hashes, signs, encrypts or touches the disk is in `@krizaka/storage/node` (the `node` condition of `.` too).
 */
export { testConnection, type TestStep } from "./connection-test";
export { type DirectUpload, type PresignedUpload } from "./direct-upload";
export { checkEndpoint } from "./endpoint";
export { assertKey, defineLayout, type Layout, trimSlashes, typeOfName } from "./keys";
export {
  DEFAULT_SCAN_TIMEOUT_MS,
  type MalwareScanner,
  memoryMalwareScanner,
  type ObjectRef,
  type ScanResult,
} from "./malware-scanner";
export { memoryObjectStore } from "./memory-store";
export {
  eventId,
  type EventSource,
  idempotent,
  memoryEventSource,
  type ObjectEvent,
  type ObjectEventHandler,
} from "./object-events";
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
export { instreamRequest, parseVerdict, scanDaemon, type ScanTransport } from "./scan-daemon";
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
