---
"@krizaka/storage": minor
---

Dropbox as a user-scope provider (ADR-005, slice 4): `dropboxStore` (App folder, upload sessions above 150 MB, no signed or public link: the app streams), the OAuth 2 PKCE helpers (`pkcePair`, `dropboxAuthorizeUrl`, `exchangeDropboxCode`, `refreshDropboxToken`, `revokeDropbox`), the new code `STORAGE_DISCONNECTED` for a revoked or expired connection, and `dropbox` opened by `openProvider`.
