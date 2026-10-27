# @krizaka/storage

## 0.3.0

### Minor Changes

- 874480e: The four pieces Yomizaka kept locally move in (#146), and the admin-over-environment rule is decided. `encryptedStore(inner, key)` (AES-256-GCM over any `ObjectStore`, key as a parameter, ciphertext only at the provider, `signedUrl`/`publicUrl` null) with `parseEncryptionKey`; the vault `seal`/`open`/`parseVaultKey` for credentials in the database; the shared region table `COUNTRY_OF_REGION` with `countryOf`, `residencyOf` and `residencyOfConfig` (Canada only when the region AND the endpoint agree, never for a Bunny-shaped zone or an unmapped region); `where(kind, active, { fixed, devOnly })`, `describeStore` and `storageNotice` (the generated residency sentence, from the configuration). New subpath `@krizaka/storage/resolve`: `resolveStorage(env, admin)` applies the admin's `storage.*` settings over the deployment's environment for any kind of data (documents, avatars), caps the signed link, and `openResolved` builds the store (encrypted when a key is given). When the environment says `none` and the admin turns keeping on, `resolveStorage` throws `StorageError` `STORAGE_KEEPING_OFF` (new codes `STORAGE_KEEPING_OFF`, `STORAGE_UNREADABLE`, `STORAGE_BAD_SECRET_KEY`): keeping is only turned on from the environment.

## 0.2.0

### Minor Changes

- fefe0d5: New packages (#44). `@krizaka/storage`: the `ObjectStore` port (`put`, `get`, `head`, `delete`, `list`, `signedUrl`, `publicUrl`), `remoteStore` (HTTP zone, token-signed links), `bucketStore` (any S3-compatible service, Signature V4 checked against AWS's vectors), `folderStore`, `memoryObjectStore`, `createStorage` (size limit passed in, declared layout, magic-number check, content-hashed names), `checkEndpoint`, `@krizaka/storage/settings` (`storage.provider` local / http / s3, limits and coordinates; `storeFromSettings`) and `objectStoreContract`. `@krizaka/video`: the `VideoProvider` port, `streamVideo` (Bunny Stream: create, delete, server-signed TUS sessions, embed and mobile view tokens, signed HLS and poster links, signed webhooks), the signing helpers and `videoProviderContract`.
