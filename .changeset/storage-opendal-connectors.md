---
"@krizaka/storage": minor
---

Every classic cloud through libraries (ADR-005 amendment, #235): `opendalStore` (`@krizaka/storage/opendal`, Apache OpenDAL as an optional peer) behind the port, with an allow-list of services, the endpoint and DNS checks kept, error mapping onto `STORAGE_*` and `readStream`; `CLOUD_CONNECTORS` and the Arctic-based connection flow (authorization code + PKCE S256, refresh with rotation, revocation) for Dropbox, Google Drive and OneDrive.
