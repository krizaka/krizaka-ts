# @krizaka/storage

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
