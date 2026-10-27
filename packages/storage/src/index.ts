/**
 * The default entry: safe on Edge and in the browser (no `node:` import, nothing that reads a file). Types and the port, the region
 * table, the residency and « where are my files » texts, the endpoint check, the type sniffer, the keys rules and the in-memory store.
 * Everything that hashes, signs, encrypts or touches the disk is in `@krizaka/storage/node` (the `node` condition of `.` too).
 */
export { checkEndpoint } from "./endpoint";
export { assertKey, defineLayout, type Layout, trimSlashes, typeOfName } from "./keys";
export { memoryObjectStore } from "./memory-store";
export * from "./port";
export { COUNTRY_OF_REGION, countryOf, type Residency, residencyOf, residencyOfConfig } from "./regions";
export { sniffType } from "./sniff";
export { describeStore, type NoticeKey, storageNotice, STORE_KIND, type StoreDescriptor, type StoreOwner, where, type WhereOptions } from "./where";
