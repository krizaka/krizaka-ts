---
"@krizaka/storage": minor
---

The registry opens the OpenDAL kinds and takes private kinds (ADR-005 amendment, #239): `google-drive` and `onedrive` implemented at user scope, `azblob`, `gcs`, `b2` and `webdav` at admin scope, each kind mapped to its adapter through a table; `createProviderRegistry({ kinds, adapters }).with({ kind, open })` registers a private provider without touching the core (every rule applies: scopes, runtimes, `devOnly`, url fields checked, secrets sealed); `Keyring` becomes a port (`{ keyId, wrap, unwrap }`, `localKeyring` the default, `sealWith`/`openWith`/`rewrapWith`), ready for a KMS with the stored `v2.<key_id>` format unchanged. Breaking for 0.x consumers: `openProvider` is asynchronous, and the old `Keyring` type (`{ keys, legacy }`) is renamed `LocalKeys`.
