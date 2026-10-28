# @krizaka/storage

Files behind one port for every Krizaka product. The port is named by what it does (`ObjectStore`), the provider is a value the admin chooses. No vendor SDK (plain HTTP through an injected `fetch`), no environment variable, no wall clock.

- **The port.** `put`, `get`, `head`, `delete`, `list(prefix)`, `signedUrl(key, ttl)` for a private zone, `publicUrl(key)` when a pull zone or CDN exists.
- **Adapters.** `remoteStore` (an HTTP zone with the shape of Bunny Storage: `AccessKey` header, `PUT`/`GET`/`DELETE`, a directory listed by its path with a trailing slash, a pull zone with token-signed links), `bucketStore` (any S3-compatible service: Signature V4, presigned GET, `ListObjectsV2`, no SDK), `folderStore` (a folder, for development, tests and the Mac apps; a key never leaves the root), `memoryObjectStore`. All run `objectStoreContract` (`@krizaka/storage/testkit`).
- **Rules every upload obeys** (`createStorage`): the size limit is passed in, the prefix must be declared in a `defineLayout` (an unknown prefix is refused), the bytes are checked by magic number (`sniffType`: png, jpeg, gif, webp, pdf, mp4, webm, svg), never by the extension, and a declared type that contradicts the bytes is refused. The stored name is content-hashed, `<name>.<sha10>.<ext>`, so a URL never changes content.
- **The admin chooses** (`@krizaka/storage/settings`): `storage.provider` (`local`, `http`, `s3`), `storage.maxMegabytes`, `storage.signedUrlSeconds`, and the non-secret coordinates (`endpoint`, `region`, `bucket`, `zone`, `prefix`, `pullHostname`, `publicBaseUrl`). Keys stay in the environment; `storeFromSettings` takes them as parameters and refuses a provider chosen without what it needs, instead of falling back to another. An admin-typed S3 endpoint goes through `checkEndpoint` (https only, no credentials, no local or private address).
- **Encryption at rest, the vault, regions and `where`.** `encryptedStore(inner, key)` (AES-256-GCM over any `ObjectStore`; the key is a parameter; the provider holds ciphertext; no link is handed out), `seal`/`open` (credentials in the database, `v1.` envelope), `COUNTRY_OF_REGION` (the one region table: an unlisted region is never a country; `residencyOfConfig` says « canada » only when the region and the endpoint agree, never for a Bunny-shaped zone), `where(kind, active, { fixed, devOnly })` and `storageNotice` (the sentence key of the info panel, from the configuration).
- **Admin over environment** (`@krizaka/storage/resolve`). `resolveStorage(env, admin)` serves every kind of data (documents, avatars: pass each its own `DeploymentStorage`): the admin's `storage.*` wins, the environment gives the secrets and the fallback when the admin left `local`. If the environment says `none` and the admin turns keeping on, it throws `StorageError` `STORAGE_KEEPING_OFF` (call it when saving the setting to refuse early): keeping is turned on in the environment, never by a setting alone. `openResolved` builds the store, encrypted when a key is given.
- **Provider registry** (ADR-005). `PROVIDER_KINDS` is the table of kinds as data (`bunny`, `s3` with presets DigitalOcean Spaces, AWS S3, OVHcloud and generic, `dropbox`, reserved `google-drive`/`onedrive`, `folder`, `device`): scopes, runtimes, `devOnly`, capabilities, coordinate and credential field schemas. `openProvider(kind, coordinates, credentials, { runtime, environment, fetch, clock })` (`/node`) is the only factory: it refuses (`STORAGE_BAD_CONFIG`) `devOnly` kinds in `prod`, `folder` outside `dev`, an unknown or unimplemented kind and a missing field, and never falls back. It returns the store and a `ResidencyLabel` (`PROVINCE_OF_REGION`: « Canada (Québec) », « Canada (Ontario) »…) for the screen to show before saving. `testConnection` (probe write, read, compare, delete) and `checkEndpointDns` (the written form plus the DNS answer: a private address is refused) serve every product.
- **Envelope vault.** `sealEnvelope`/`openEnvelope`/`rewrapEnvelope`: a data key per sealed value, wrapped by the key-encryption key (`MEDIA_VAULT_KEY`) named by a `key_id` (`v2.<key_id>.<wrapped>.<sealed>`); `v1.` values still open with the legacy key; rotating the key re-wraps the data keys only.
- **Signatures.** SigV4 is checked against AWS's published vectors. The token form of the HTTP zone's signed links (SHA-256 of key + path + expires, URL-safe base64) is the one Yomizaka and Orochia run against Bunny's pull zones; Bunny's documentation publishes no expected output for it.

```ts
import { createStorage, defineLayout, folderStore } from "@krizaka/storage";
import { limitsOf, readStorageSettings, storeFromSettings } from "@krizaka/storage/settings";

const settings = await readStorageSettings((key) => service.get(key, ctx));
const storage = createStorage({
  store: storeFromSettings(settings, { accessKeyId: env.MEDIA_STORAGE_ACCESS_KEY_ID, secretAccessKey: env.MEDIA_STORAGE_SECRET }, { fetch, clock }),
  layout: defineLayout(["people/", "site/home/"]),
  limits: () => readStorageSettings(read).then(limitsOf),
});
const { key, url } = await storage.upload({ prefix: "people/", name: "ana.jpg", bytes, allow: ["image/jpeg", "image/png"], declaredType: file.type });
```

Apache-2.0.
