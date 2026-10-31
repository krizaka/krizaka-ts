# @krizaka/storage

## 0.11.0

### Minor Changes

- 8dd09b8: The managed provider kind (ADR-020): any S3-compatible bucket plus a KMS (`okms`, `aws-kms`, `local` in development), entered by the admin and sealed, with one encrypted store per tenant (`forTenant`) and a probe store for the connection test; `managedResidency` with the declared replica; the admin's controls in `@krizaka/storage/settings` (`managedStorageSettings`, `resolveManagedPolicy` tenant > plan > product > global, `providerAllowed`, `linkSeconds`, `MANAGED_PRICE_IDS`); OVHcloud Toronto and Google Cloud's Canadian regions in the region table; the Google Cloud Storage interoperability preset; `memoryKeyService({ root })`.

## 0.10.0

### Minor Changes

- 6dfa030: Per-tenant envelope encryption for the managed document storage (ADR-020 Decision 3): the `KeyService` KMS port with `memoryKeyService` and `cloudKeyService` (`aws-kms`, `okms`), `tenantVault` (a KEK per tenant kept wrapped in the database, a DEK per object version, AES-256-GCM), `tenantStore` (an `ObjectStore` under `t/<tenantId>/`), tenant and root rotation with an idempotent rewrap, `shredTenant` (crypto-shredding), `dbTenantKeyStore` on `storageSchema` v2, and the `keyServiceContract` / `tenantKeyStoreContract` test kits.

## 0.9.0

### Minor Changes

- 3add8d7: `readUpload(request, { field, maxBytes })`: reads one uploaded file from a multipart request — refuses an oversize body from `Content-Length` before reading it, then a missing, empty or too large file (`StorageError` `tooBig` / the new `noFile`). The type stays `Storage.upload`'s to decide, by magic number. Apps no longer hand-roll the size check and the form parsing.

## 0.8.1

### Patch Changes

- 2272b57: The READMEs, comments and published declarations no longer name the products that left the organisation (krizaka/.github#413, rule `no-departed-published`). The sources were cleaned in #262 with an empty changeset, so the published tarballs still carried the old text; this release replaces them. No behaviour change.
- Updated dependencies [2272b57]
  - @krizaka/settings@0.5.2

## 0.8.0

### Minor Changes

- 9254bd2: Every classic cloud through libraries (ADR-005 amendment, #235): `opendalStore` (`@krizaka/storage/opendal`, Apache OpenDAL as an optional peer) behind the port, with an allow-list of services, the endpoint and DNS checks kept, error mapping onto `STORAGE_*` and `readStream`; `CLOUD_CONNECTORS` and the Arctic-based connection flow (authorization code + PKCE S256, refresh with rotation, revocation) for Dropbox, Google Drive and OneDrive.
- 894e097: The registry opens the OpenDAL kinds and takes private kinds (ADR-005 amendment, #239): `google-drive` and `onedrive` implemented at user scope, `azblob`, `gcs`, `b2` and `webdav` at admin scope, each kind mapped to its adapter through a table; `createProviderRegistry({ kinds, adapters }).with({ kind, open })` registers a private provider without touching the core (every rule applies: scopes, runtimes, `devOnly`, url fields checked, secrets sealed); `Keyring` becomes a port (`{ keyId, wrap, unwrap }`, `localKeyring` the default, `sealWith`/`openWith`/`rewrapWith`), ready for a KMS with the stored `v2.<key_id>` format unchanged. Breaking for 0.x consumers: `openProvider` is asynchronous, and the old `Keyring` type (`{ keys, legacy }`) is renamed `LocalKeys`.

### Patch Changes

- Updated dependencies [ce40b60]
  - @krizaka/db@0.3.1

## 0.7.0

### Minor Changes

- e8f4ec7: `storageSettings` has `storage.userConnectors` (flag, **off by default**): the admin's policy on whether people may connect their own cloud (Dropbox, an S3 of their own). `userConnectorsAllowed(read)` reads it; anything but an explicit `true` is off.

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.6.0

### Minor Changes

- 2b30ee8: Dropbox as a user-scope provider (ADR-005, slice 4): `dropboxStore` (App folder, upload sessions above 150 MB, no signed or public link: the app streams), the OAuth 2 PKCE helpers (`pkcePair`, `dropboxAuthorizeUrl`, `exchangeDropboxCode`, `refreshDropboxToken`, `revokeDropbox`), the new code `STORAGE_DISCONNECTED` for a revoked or expired connection, and `dropbox` opened by `openProvider`.
- 76fbcf5: Providers in the database (ADR-005, slice 2), in `@krizaka/storage/provider-admin`: `storageSchema`, `dbProviderStore` / `memoryProviderStore` with a contract, `createProviderService` (create, test, set default, change key, disable, retire, rotate the vault key, bootstrap from the environment; secrets returned as set / not set, every change audited), `moveBatch` (SHA-256-verified move) and `readDual` (reads from both stores during a move).

## 0.5.0

### Minor Changes

- b4d916e: Provider registry (ADR-005, slice 1): `PROVIDER_KINDS` as data, `openProvider` with the runtime and environment guards (`devOnly` refused in `prod`, `folder` only in `dev`), `PROVINCE_OF_REGION` and `residencyLabel`, `testConnection` and `checkEndpointDns` moved from Yomizaka, and the envelope vault (`sealEnvelope`, `openEnvelope`, `rewrapEnvelope`, `keyIdOf`, `v2.` values with a `key_id`; `v1.` still opens).

## 0.4.0

### Minor Changes

- 9e54d74: `sweepOrphans(store, prefix, isReferenced, { dryRun, limit })`: deletes the files under a prefix that nothing references (leftovers of a rolled-back upload or an interrupted purge), reports scanned / orphans / deleted / failed, never stops on one failing delete.

## 0.3.1

### Patch Changes

- 33d114d: The default entry is safe on Edge and in the browser: no `node:` import, nothing reads a file. It carries the types and the port, the region table, `describeStore`, `storageNotice`, the endpoint check, `sniffType`, the key rules and the in-memory store. The adapters that hash, sign, encrypt or touch the disk (`createStorage`, `bucketStore`, `remoteStore`, `folderStore`, `encryptedStore`, `hashedName`, `seal`/`open`) are in `@krizaka/storage/node`, and `.` still resolves to them under the `node` condition, so Node code keeps working unchanged. A test bundles the default entry for the browser and fails on any `node:` or `fs` import.

## 0.3.0

### Minor Changes

- 874480e: The four pieces Yomizaka kept locally move in (#146), and the admin-over-environment rule is decided. `encryptedStore(inner, key)` (AES-256-GCM over any `ObjectStore`, key as a parameter, ciphertext only at the provider, `signedUrl`/`publicUrl` null) with `parseEncryptionKey`; the vault `seal`/`open`/`parseVaultKey` for credentials in the database; the shared region table `COUNTRY_OF_REGION` with `countryOf`, `residencyOf` and `residencyOfConfig` (Canada only when the region AND the endpoint agree, never for a Bunny-shaped zone or an unmapped region); `where(kind, active, { fixed, devOnly })`, `describeStore` and `storageNotice` (the generated residency sentence, from the configuration). New subpath `@krizaka/storage/resolve`: `resolveStorage(env, admin)` applies the admin's `storage.*` settings over the deployment's environment for any kind of data (documents, avatars), caps the signed link, and `openResolved` builds the store (encrypted when a key is given). When the environment says `none` and the admin turns keeping on, `resolveStorage` throws `StorageError` `STORAGE_KEEPING_OFF` (new codes `STORAGE_KEEPING_OFF`, `STORAGE_UNREADABLE`, `STORAGE_BAD_SECRET_KEY`): keeping is only turned on from the environment.

## 0.2.0

### Minor Changes

- fefe0d5: New packages (#44). `@krizaka/storage`: the `ObjectStore` port (`put`, `get`, `head`, `delete`, `list`, `signedUrl`, `publicUrl`), `remoteStore` (HTTP zone, token-signed links), `bucketStore` (any S3-compatible service, Signature V4 checked against AWS's vectors), `folderStore`, `memoryObjectStore`, `createStorage` (size limit passed in, declared layout, magic-number check, content-hashed names), `checkEndpoint`, `@krizaka/storage/settings` (`storage.provider` local / http / s3, limits and coordinates; `storeFromSettings`) and `objectStoreContract`. `@krizaka/video`: the `VideoProvider` port, `streamVideo` (Bunny Stream: create, delete, server-signed TUS sessions, embed and mobile view tokens, signed HLS and poster links, signed webhooks), the signing helpers and `videoProviderContract`.
