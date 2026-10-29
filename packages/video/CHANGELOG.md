# @krizaka/video

## 0.2.1

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0

## 0.2.0

### Minor Changes

- fefe0d5: New packages (#44). `@krizaka/storage`: the `ObjectStore` port (`put`, `get`, `head`, `delete`, `list`, `signedUrl`, `publicUrl`), `remoteStore` (HTTP zone, token-signed links), `bucketStore` (any S3-compatible service, Signature V4 checked against AWS's vectors), `folderStore`, `memoryObjectStore`, `createStorage` (size limit passed in, declared layout, magic-number check, content-hashed names), `checkEndpoint`, `@krizaka/storage/settings` (`storage.provider` local / http / s3, limits and coordinates; `storeFromSettings`) and `objectStoreContract`. `@krizaka/video`: the `VideoProvider` port, `streamVideo` (Bunny Stream: create, delete, server-signed TUS sessions, embed and mobile view tokens, signed HLS and poster links, signed webhooks), the signing helpers and `videoProviderContract`.
