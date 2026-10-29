/** `@krizaka/storage/opendal`: the OpenDAL adapter. Its own entry so the native module (`opendal`, an optional peer) is loaded only by a product that opens one. */
export { OPENDAL_SERVICES, type OpendalObjectStore, type OpendalService, opendalStore, type OpendalStoreOptions, storageErrorOf } from "./opendal-store";
