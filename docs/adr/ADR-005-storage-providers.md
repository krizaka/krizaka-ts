# ADR-005: Storage providers are chosen by the admin, in the database; users may connect their own clouds

- **Status:** accepted (2026-10-28) as the direction. The slices are separate work, filed as sub-issues of krizaka/krizaka-ts#216.
- **Amended** (2026-10-28, krizaka/krizaka-ts#235): the classic clouds through libraries, not hand-written adapters. See [Amendment: libraries, not one adapter per provider](#amendment-2026-10-28-libraries-not-one-adapter-per-provider).
- **Issue:** krizaka/krizaka-ts#216.
- **Builds on:** [ADR-001](ADR-001-modular-architecture.md) (ports and adapters, settings as data), [ADR-004](ADR-004-non-ui-packages-move-here.md) (server logic lives here). Amends Yomizaka ADR-0012 (« document bytes out of the database »), as already amended by krizaka/yomizaka#520.
- **Packages:** `@krizaka/storage` (0.4.0 today), with `@krizaka/settings`, `@krizaka/audit`, `@krizaka/outbox` and `@krizaka/privacy`.

## Context

Oussama, 2026-10-28: « l'admin configure le comportement du BFF (web) : il autorise le storage dans Bunny en fournissant la clé dans l'interface ; le user peut connecter des clouds à lui (Dropbox, S3…). Propre au web : on n'écrit pas sur le disque local du serveur. Sur les clients lourds (mobile, macOS) cette limitation n'existe pas. » The same day: Bunny (New York) is **for development only**, and production moves to a provider **in Canada** before the public opening.

What exists today:

- `@krizaka/storage` has the port (`ObjectStore`: put, get, head, delete, list, signedUrl, publicUrl) and three adapters over an injected `fetch`. `remoteStore` is a Bunny-style zone with a token-authenticated pull zone. `bucketStore` is any S3-compatible bucket, signed with Signature V4 and no SDK. `folderStore` is a local folder. Around them: `encryptedStore` (AES-256-GCM per object), `vault` (`seal`/`open` for one credential), the region table (`COUNTRY_OF_REGION`, `residencyOfConfig`), `describeStore`/`where`/`storageNotice`, `checkEndpoint` and `sweepOrphans`.
- The provider choice is split in two today. The admin picks `storage.provider` and the non-secret coordinates in `storage.*` settings. **The keys stay in the environment** (`resolveStorage` merges both, and `none` in the environment wins).
- Yomizaka (`apps/web/lib/storage`): `storageFrom` reads `MEDIA_DOCUMENTS_*`, `MEDIA_STORAGE_*` and `MEDIA_S3_*` from the environment. An owner may already have its **own S3**: the secret is sealed in the database, and `verifyS3` checks the endpoint's DNS answer and writes a probe. There is also a connection test (`testConnection`: put, get, compare, delete). Since yomizaka#520, PostgreSQL holds no document bytes. `none` is the default: on a deployed app, uploads answer 503 `STORAGE_NOT_CONFIGURED`. `folder` is opt-in and refused when `NODE_ENV=production`.
- The development deployment uses the private Bunny zone `yomizaka-docs-dev` (region NY, empty) behind the token-authenticated pull zone `yomizaka-docs-dev.b-cdn.net`. `docs/privacy/transfers.json` declares it as outside Québec and outside Canada. Bunny Storage has **no Canadian region**: only its CDN edges are in Toronto and Montréal.

Three problems follow. A key in the environment means a redeploy to change providers, and nobody can see or audit the change. The pieces a second product would need (the own-S3 verification, the connection test) live in Yomizaka. Nothing describes how documents move when the provider changes.

## Decision

### 1. A provider registry, as data, in `@krizaka/storage`

A **provider kind** is a data entry, one line per kind. It is not a branch in a factory:

```ts
interface ProviderKind {
  kind: "bunny" | "s3" | "dropbox" | "google-drive" | "onedrive" | "folder" | "device";
  scopes: readonly ("admin" | "user")[];            // who may configure it
  runtimes: readonly ("server" | "dev" | "device")[]; // where it may run (`server` = a deployed web BFF)
  devOnly: boolean;                                   // fictional data only: refused when the environment is `prod`
  capabilities: { private: boolean; signedUrls: boolean; publicUrls: boolean; maxObjectBytes: number; serverSideEncryption: "none" | "provider" | "customer-key" };
  residency: "from-region" | "user-cloud" | "device" | "fixed-elsewhere";
  coordinates: FieldSchema[];   // non-secret: endpoint, region, bucket, zone, pull hostname, prefix
  credentials: FieldSchema[];   // secret: access key id/secret, zone password, token key, OAuth refresh token
  presets?: Preset[];           // S3 only: endpoint templates and known regions (DO Spaces, AWS S3, OVHcloud, generic)
}
```

| Kind | Scopes | Runtimes | Adapter | Notes |
|---|---|---|---|---|
| `bunny` | admin | server, dev | `remoteStore` (exists) | `devOnly: true`: no Canadian region, so it is refused when the environment is `prod` (the rule leaves Yomizaka's `storageFrom` for the package). Private zone, links signed by the pull zone's token key. |
| `s3` | admin, user | server, dev | `bucketStore` (exists) | Presets: **DigitalOcean Spaces** (`<region>.digitaloceanspaces.com`), **AWS S3** (`s3.<region>.amazonaws.com`), **OVHcloud** (`s3.<region>.io.cloud.ovh.net`), and **generic** (any HTTPS endpoint, checked by `checkEndpoint` plus a DNS check). A preset only fills in fields: it adds no new code. |
| `dropbox` | user | server | new `dropboxStore` | OAuth 2 with PKCE and an offline refresh token, **App folder** access only. `signedUrls: false`: Dropbox temporary links live 4 h, longer than our 900 s cap, so the app streams the file. Residency is `user-cloud`, so the app makes no claim about where it is. |
| `google-drive`, `onedrive` | user | server | `opendalStore` + `cloud-connectors` (amendment) | Reserved in the registry until the registry opens the OpenDAL kinds. No per-provider adapter: a line of `CLOUD_CONNECTORS` and an OpenDAL service. |
| `folder` | — | dev | `folderStore` (exists) | **Never on a deployed server.** `openProvider` refuses it unless the runtime is `dev`, so the web BFF cannot write to the server's disk. |
| `device` | — | device | the client's own (yomizaka#154, #155) | Mobile sandbox, macOS folder. The server never opens a `device` store. |

`openProvider(kind, coordinates, credentials, { runtime, environment, fetch, clock })` is the only factory. It refuses with `STORAGE_BAD_CONFIG` when the kind is not allowed in the runtime or the environment (a `devOnly` kind in `prod`, `folder` on `server`). It never falls back to another kind. A file must not land somewhere nobody expects.

The pieces that live in Yomizaka today **move into the package**, because the libraries come first: `testConnection` (probe put, get, compare, delete), the DNS check of `verifyS3` (in `@krizaka/storage/node`, beside `checkEndpoint`), and the own-bucket descriptor. Yomizaka then imports them.

### 2. Admin providers live in the database, credentials sealed under one key

- **Tables** (the package's migration, in the product's database): `storage_providers` and `storage_defaults`.
  - A `storage_providers` row holds `id`, `scope` (`org` or `user:<id>`), `kind`, `preset`, `label`, `coordinates` (jsonb, non-secret), `sealed_credentials` (text), `key_id`, `status`, `last_test` (steps and the residency it found, never a value), `created_by` and `updated_at`.
  - A provider's `status` is one of `draft`, `verified`, `active`, `retiring` or `disabled`.
  - A `storage_defaults` row holds `scope`, `data_kind` (`documents`, `avatars`…) and `provider_id`.
- **Envelope encryption.** The **only** environment variable is the key-encryption key, `MEDIA_VAULT_KEY` (32 bytes in base64, `MEDIA_` context, krizaka/.github#46).
  - Each provider row gets a random data key, wrapped by `MEDIA_VAULT_KEY` and stored with its `key_id`. The credentials are sealed under that data key (`seal`/`open`, `v1.` today, `v2.<key_id>.` with the envelope).
  - Rotating the key-encryption key re-wraps the data keys only: no credential is retyped.
  - The **object-encryption key** (today `MEDIA_DOCUMENTS_ENCRYPTION_KEY`) becomes a sealed credential of its provider, generated when the provider is created. The existing key is imported once, so the existing objects still open.
- **Keys are never shown back.** The API returns each secret field as `set` or `not set`, with who changed it and when, and never the last characters. Changing a key means entering a new one. Credentials are opened in exactly one place, the server's `openProvider`. The admin cannot see a user's credentials either.
- **Test before save.** Saving a provider runs `testConnection` against the candidate and records the residency it detected. Only a green test moves a provider from `draft` to `verified`. Only a `verified` provider can become a default.
- **Audit.** Every create, update, key change, test, activation, switch, disable and move goes through `@krizaka/audit`. The diff is redacted: a secret field reads `changed`, never its value.
- **The environment only bootstraps.** On the first start, if the database has no provider and the environment carries the old `MEDIA_*` coordinates and keys, the product imports them once as an `active` provider with `source: "env"`, and records that in the audit trail. From then on the environment chooses nothing. `resolveStorage`'s merge of environment and settings is deprecated. It is removed when Yomizaka and Akinaza have adopted the registry.
- **With no provider**, ADR-0012 (as amended by yomizaka#520) stays: nothing is kept, uploads answer 503 `STORAGE_NOT_CONFIGURED`, translated EN/FR, and **no bytes go into PostgreSQL**.

### 3. Switching provider is a verified move, with reads from both stores during it

1. The admin adds and verifies the new provider, then makes it the default. From that moment, **new writes go to the new store**.
2. A move job (an `@krizaka/outbox` event, leased workers, a bounded batch per run, resumable) takes each object of the old provider:
   - **get** it from the old store (decrypted);
   - **put** it to the new one (encrypted under the new provider's key);
   - **read it back and compare its SHA-256** with the hash recorded at upload;
   - then **switch the row's `provider_id`** in one transaction.
   A mismatch or a failure goes to the move's dead letters and is retried. It is never switched.
3. **Reads from both stores.** A read uses the row's `provider_id`. If the new store does not hold the object yet, the read falls back to the old one. The old provider is `retiring` and keeps reading until no row references it.
4. **Retire.** When the count of objects reaching the old provider is zero, the admin confirms. Only then does a sweep delete the old copies, and the old provider becomes `disabled`. A provider that rows still reach can be neither deleted nor disabled.
5. The admin screen shows the move: copied, verified, failed, left to move. Going back is the same move in the other direction.

Each object records **which provider holds it** (`provider_id`, the object key, size, type and SHA-256). `where` then answers, for that object, where it lives right now, never where the default points.

### 4. Users may connect their own clouds

- **The admin allows it.** A setting `storage.userConnectors` lists the kinds users may connect. It is empty by default, so the admin configures everything. Dropbox comes first. Then S3 with keys: the same `s3` kind at `user` scope, with the DNS check, so a user's endpoint never reaches our own network.
- **Connecting.** Dropbox uses OAuth 2 with PKCE. The refresh token is sealed like any credential, and the user can revoke it from our screen (which calls Dropbox's `token/revoke`) or from Dropbox. A dead token makes reads answer a new `STORAGE_DISCONNECTED` code. The documents then read « unreachable »: they are never moved or deleted without the user's action.
- **What stays with us:** the metadata (name, type, size, SHA-256, `provider_id`, object key, dates), the product's results (a check's report), and the audit trail. **What lives in the user's cloud:** the bytes, in clear, as the user's own file. Their provider's encryption applies. Our object key would make the file unreadable to its owner. Every read checks the SHA-256. A file changed outside reads « changed since upload » and is never used silently for a check.
- **Purge, retention, erasure.**
  - Our retention and the `@krizaka/privacy` erasure delete **what we hold**: the metadata, the results and the token, which is revoked.
  - The bytes in the user's cloud are the user's. An erasure does not delete them. The export lists where they are.
  - A document the user deletes in the app is deleted in their cloud too, if it is still there and its hash still matches.
  - A transient working copy (a check's input, purged after the check) **never** goes to a user's cloud. It stays in the deployment's store, or in memory.
- The notice says it per object: « Kept: your Dropbox », or « Kept: your bucket (`<endpoint>`, `<region>`) » (`owner: "workspace"` today, `user` added).

### 5. The web never writes the local disk; heavy clients keep files locally

- On a deployed server only the cloud kinds open (`runtimes`). `folder` is `dev` only. Yomizaka's start-up refusal (`NODE_ENV=production` with `folder`) stays as the product's second guard. An ast-grep rule (`no-folder-store-in-web`, in the `@krizaka/config` pack) refuses a `folderStore` import under `apps/web/**` outside tests and dev scripts.
- **Mobile and macOS** (yomizaka#154, #155) keep the bytes in a `device` store. They sync only the metadata through the API (the same row, with `provider_id` null and kind `device`). The server receives bytes only as the transient working copy a check needs, then purges it.

### 6. Residency is shown per provider, and production moves to Canada

- **Every provider shows its residency to the admin or user before saving.** The residency is computed by `describeStore` and the region table: « Canada (Québec) », « Canada (Ontario) », « elsewhere: US », or « unknown: your cloud ». The region table gains a province column (`PROVINCE_OF_REGION`: `ca-central-1` and `bhs` → QC, `tor1` → ON, `ca-west-1` → AB), because Loi 25 counts **outside Québec**, not outside Canada.
- **Bunny NY is for development only.** The rule is in the registry (`devOnly`), not in a product.
- **Production, before the public opening, uses a Canadian provider** through the `s3` kind. The switch is a setting plus the move of §3, not a migration project.

#### Comparison (checked 2026-10-28; prices are list prices to confirm when signing)

| Provider | Where | S3 API | Price (list) | Encryption | Contract and law | Sources |
|---|---|---|---|---|---|---|
| **DigitalOcean Spaces `tor1`** | Toronto, Ontario (outside Québec) | yes (already our `bucketStore` and in `transfers.json`) | USD 5 a month, with 250 GiB and 1 TiB of outbound traffic; then 0.02 USD/GiB stored, 0.01 USD/GiB out | in transit over HTTPS. SSE-C is available. At rest, ours: `encryptedStore`, so the provider only ever holds ciphertext | US company (CLOUD Act). Our current vendor: the app (`tor`) and the managed PostgreSQL are already there, under one DPA | [pricing](https://www.digitalocean.com/pricing/spaces-object-storage), [regions](https://docs.digitalocean.com/products/spaces/details/availability/) |
| **AWS S3 `ca-central-1`** | Montréal area, Québec | native | per-region list price on the S3 pricing page (the same order as us-east-1, 0.023 USD/GB-month), plus requests and outbound traffic | SSE-S3 or SSE-KMS by default, plus ours | US company (CLOUD Act). AWS customer agreement and DPA, new vendor | [launch, Montréal](https://press.aboutamazon.com/2016/12/amazon-web-services-cloud-now-available-to-customers-from-data-centers-in-canada), [S3 pricing](https://aws.amazon.com/s3/pricing/) |
| **AWS S3 `ca-west-1`** | Calgary, Alberta | native | as above | as above | as above. A backup region, not a primary | [regions](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/) |
| **OVHcloud Object Storage `bhs`** | Beauharnois, Québec | yes (« S3 compatible ») | per GB-month by class; **no ingress, egress or API fees** (Standard). The BHS price is to read on the regional price page | SSE-C or SSE-OMK, plus ours | OVHcloud Canada; parent company in France. New vendor | [product](https://www.ovhcloud.com/en-ca/public-cloud/object-storage/), [regions](https://www.ovhcloud.com/en-ca/public-cloud/regions-availability/) |
| ThinkOn | Canadian; sites in Toronto, Montréal and Calgary (2017 source) | S3 on NetApp StorageGRID / Cloudian | on quote | provider, plus ours | Canadian-owned, « not subject to foreign data access ». Wholesale or partner sales | [Cloudian, 2017](https://cloudian.com/press/thinkon-expands-storage-services-program-cloudian-object-storage/), [NetApp](https://www.netapp.com/customers/thinkon/) |
| FullHost Object Storage | « hosted entirely in Canada »; city not stated | yes (`s3.fullhost.net`) | to ask | ours | Canadian, launched 2026-05-28 | [announcement](https://manage.fullhost.com/announcements/68/Now-Available-FullHost-Object-Storage--S3-Compatible-Hosted-in-Canada.html) |

We found no Québec-owned public S3 provider with a public offer and a published price. ThinkOn and FullHost would need a sales call to confirm their sites and terms.

#### Recommendation

1. **At the opening: DigitalOcean Spaces `tor1`.** It is the same vendor and the same region as the app and the database, so one contract, one DPA and one Loi 25 assessment cover the app, the database and the files. The cost is the lowest at our size (USD 5 a month). There is no new code, because `bucketStore` and the region table already know it. The bytes are encrypted with our key before they leave, so the provider holds only ciphertext. The database already lives in Toronto, so storing the files in Québec alone would not take the processing out of the « outside Québec » case.
2. **The Québec option: OVHcloud `bhs`** (no traffic fees), or **AWS `ca-central-1`**. Either one is a preset of the same `s3` kind. We take it the day a customer requires Québec residency, or when the whole stack moves to Québec. The switch is §3's move.
3. A Canadian-owned provider (ThinkOn, FullHost) is asked for a quote only if a customer requires no exposure to foreign law. Even then the choice is a preset, not a new adapter.

#### Loi 25

- Placing files with a provider is a **communication outside Québec** when the provider is in Toronto: Spaces `tor1` (and the PostgreSQL database already). Article 17 of the private sector act requires a **privacy impact assessment (EFVP)** before that communication. It weighs the sensitivity of the data, the purpose, the protections (our encryption, the DPA) and the legal regime of the place.
- Any new information system that handles personal information needs an EFVP anyway (art. 3.3). So the **production** choice carries its EFVP, whatever the region. Development holds fictional data only and needs none.
- Following « legal go until lawyer »: we write the EFVP from the act, in good faith, before production. A lawyer reviews it once before the public opening. `docs/privacy/transfers.json` (Yomizaka) records the chosen provider. Its test already fails when a store is not declared.

## Consequences

- One factory and one source of rules, for every product: a second product (Akinaza) adopts storage by registering its data kinds, not by copying Yomizaka's `storageFrom`.
- The environment holds one key. Changing provider or key needs no redeploy, and every change appears in the audit trail.
- Losing `MEDIA_VAULT_KEY` makes the sealed credentials and the object keys unreadable. It is kept in the secret manager with a backup copy outside the deployment. The rotation procedure (re-wrap) is part of slice 2.
- During a move, reads may reach two providers: this costs a little latency, never a missing file.
- A user's cloud means we cannot promise residency for those files. The notice says so, and nothing claims Canada for them.

## Slices (sub-issues of krizaka/krizaka-ts#216)

1. **krizaka-ts#219:** the registry (kinds, capabilities, credential schemas, S3 presets), `openProvider` with the runtime and environment guards, the province table, `testConnection` and the DNS check moved from Yomizaka, and the envelope vault with `key_id`.
2. **krizaka-ts#220:** provider persistence and the move job: the schema, a service that never returns secrets and audits every change, the bootstrap import from the environment, the move (copy, SHA-256 check, switch, reads from both stores, retire) with a conformance kit.
3. **yomizaka#522:** the admin storage settings, API and screen (`@krizaka/ui` blocks; a missing block goes to krizaka-ui first): list, add, test, set as default, change a key, the move's progress, the audit trail, EN/FR and both themes.
4. **krizaka-ts#221** (with the Yomizaka screens): user connectors, Dropbox first (`dropboxStore`, the OAuth PKCE helpers, revoke, `STORAGE_DISCONNECTED`), then S3 keys at user scope; the user screen and the « Kept: your Dropbox » notice.
5. **yomizaka#523:** adoption. The registry replaces `storageFrom`'s environment selection (`APP_DOCUMENTS_STORE` stays only as `folder` for dev); the environment only bootstraps; `provider_id` is recorded per document; ADR-0012 and `transfers.json` are amended.
6. **yomizaka#524 (needs Oussama):** the production document store in Canada: the Spaces `tor1` bucket and DPA, the EFVP, the switch from the admin screen.
7. **akinaza#517:** adoption, after Yomizaka.

## Needs Oussama

- **The production provider contract** (yomizaka#524): opening the paid Spaces `tor1` bucket (or another provider from the table) and accepting its DPA. This is paid, and the data processing agreement is a legal commitment. Everything else is reversible and proceeds without waiting.

## Amendment (2026-10-28): libraries, not one adapter per provider

- **Issue:** krizaka/krizaka-ts#235. Oussama, 2026-10-28: « Dropbox c'est un exemple, il faut couvrir tous les providers classiques. À l'époque c'était Passport ; aujourd'hui il y a sûrement mieux. »
- **Decided with a working proof** (this pull request): `@krizaka/storage/opendal` (`opendalStore`) and `cloud-connectors.ts` (`CLOUD_CONNECTORS`, `startConnection`, `finishConnection`, `refreshConnection`, `revokeConnection`, `connectionAccessToken`), with their tests.

### What the spike found (OpenDAL `opendal` 0.49.13 on npm, Arctic 3.7.0)

**What the published Node binding really ships.** We constructed an operator for each scheme (`new Operator(scheme, options)`):

| Works | Not in the npm binding (`Unsupported`) |
|---|---|
| Object stores: `s3`, `gcs`, `azblob`, `azdls`, `azfile`, `b2`, `swift`, `oss`, `cos`, `obs`, `upyun`, `tos` | `ftp`, `sftp` |
| Consumer clouds: `gdrive`, `onedrive`, `dropbox`, `webdav` (Nextcloud, ownCloud), `seafile`, `koofr`, `yandex-disk`, `aliyun-drive` | `pcloud`, `icloud` |
| Others we do **not** allow: `fs`, `memory`, `http`, `postgresql`, `mysql`, `redis`, `mongodb`, `sqlite`, caches… | `hdfs` |

- **The proof.** The package's `objectStoreContract` passes on OpenDAL `fs` (with and without a prefix) and on a real S3-compatible server in a container (SeaweedFS through Testcontainers, `STORAGE_S3_IT=1` in CI). MinIO's public images are gone from Docker Hub and Quay, so we could not use them. A presigned read link is served. Wrong keys give `STORAGE_PROVIDER_FAILED`, never a silent `null`. A 6 MiB file streams back in several chunks (`readStream`).
- **Error mapping.** OpenDAL errors carry their kind as the first word of the message (`NotFound (permanent) at read…`). `NotFound` gives `null`. `PermissionDenied` on an OAuth cloud gives `STORAGE_DISCONNECTED`, and on keys it gives `STORAGE_PROVIDER_FAILED`. `ConfigInvalid` and `Unsupported` give `STORAGE_BAD_CONFIG`. Anything else gives `STORAGE_PROVIDER_FAILED`. The message is never passed on, because it may quote a path or the provider's answer.
- **SSRF guards kept.** `OPENDAL_SERVICES` is an allow-list: a typed coordinate cannot open `postgresql`, `redis` or `http`. `fs` and `memory` need `allowLocal` (dev and tests only). A typed endpoint (`s3`, `webdav`, `swift`, `azblob`, `gcs`) passes `checkEndpoint` (https only, no credentials in the URL, no local name, no private, loopback or link-local literal such as `169.254.169.254`). It also passes `checkEndpointDns` before OpenDAL is called. **A limit:** OpenDAL makes its HTTP calls from Rust, with its own resolver. We cannot inject `fetch` or pin the checked address, so DNS rebinding stays possible between the check and the call. The product's network egress rules remain the second guard, as ADR-005 already says for names.
- **OAuth.** OpenDAL refreshes Dropbox tokens itself only for a confidential client (`client_secret must be set when refresh_token is set`). So **Arctic owns the tokens and OpenDAL only receives a short-lived access token** (`accessToken: () => Promise<string>`; the operator is rebuilt when the token changes).
  - We do not use Arctic's per-provider classes. Its `Dropbox` class sends no PKCE, and it revokes in the RFC 7009 style, which Dropbox does not speak. Its `MicrosoftEntraId` class has no revocation. We use Arctic's generic `OAuth2Client` (code + PKCE S256, refresh, RFC 7009 revoke) over **one table of endpoints**: `CLOUD_CONNECTORS` (Dropbox, Google Drive, OneDrive). Each line gives the narrowest file scope (`drive.file`, `Files.ReadWrite.AppFolder`, Dropbox's App folder), the provider's extra parameters and its revocation style (`rfc7009`, `bearer` or none).
  - The tests run the whole flow against a fake OAuth server: the S256 challenge is checked against the verifier, and a wrong verifier is refused. The refresh token is sealed with `sealEnvelope` and opened again. A refresh rotates the token, and the old one is refused with `STORAGE_DISCONNECTED`. Revocation is tested in both styles. `connectionAccessToken` caches the token until a minute before it expires, hands a rotated token to `onRotate` to be resealed, and reports the disconnect. An unreachable provider gives `STORAGE_PROVIDER_FAILED`, not a disconnect.
- **Native module.** The binary is chosen per platform (`optionalDependencies`):
  - **macOS arm64:** 70 MB. Works.
  - **linux-x64-musl:** 59 MB. Works on Yomizaka's production image (`node:22-alpine`, the pinned digest, checked in a container).
  - **linux-x64-gnu:** 82 MB. It needs **glibc ≥ 2.38**. It **fails** on Debian 12 (`node:22-bookworm`, glibc 2.36) and on Ubuntu 22.04 (DigitalOcean's buildpack stack). It works on Ubuntu 24.04 (the CI runners).
  - So a product that opens an OpenDAL provider deploys an Alpine or glibc ≥ 2.38 image, as Yomizaka and Akinaza already do through their Dockerfiles. A Next.js app lists `opendal` in `serverExternalPackages`. `opendal` is an **optional peer**, loaded on first use, and in its own entry: a product that opens no OpenDAL provider never installs or loads 60–80 MB.
- **Licence.** OpenDAL is an Apache top-level project, under Apache-2.0. The binary also ships an MPL-2.0 notice for a bundled component; that is file-level copyleft, and it does not bind our code. Arctic is MIT. Neither phones home.

### Comparison

| Option | Coverage of the classic clouds | Ops cost | Residency | Maturity | Licence | Size |
|---|---|---|---|---|---|---|
| **Apache OpenDAL (npm binding)** — chosen for files | S3 family, GCS, Azure, B2, Swift; Google Drive, OneDrive, Dropbox, WebDAV/Nextcloud, Seafile. No FTP/SFTP, pCloud or iCloud in the npm build | none: in process | in process, no third party | Apache top-level project; the Node binding is still 0.x and releases about every two weeks (0.49.10 to 0.49.13 between 2026-09-15 and 2026-10-18); a Java binding exists too | Apache-2.0 (+ a bundled MPL-2.0 component) | native, 59–82 MB per platform; glibc ≥ 2.38 or musl |
| rclone as a sidecar (`rclone rcd` / `serve s3`) | the widest (~70 backends, with SFTP, FTP, pCloud, iCloud) | a second process or container per deployment (on App Platform, one more component, billed), its own config, health checks and upgrades. Credentials must be passed on every call to stay in our vault | self-hosted | very mature (since 2012) | MIT | a ~60 MB Go binary plus its container |
| unstorage (UnJS) | key-value drivers (fs, S3, Azure, Redis, Vercel, Cloudflare, GitHub). No Google Drive, OneDrive or Dropbox | none | in process | active, made for caches and KV | MIT | small, pure JS |
| flystorage (Flysystem for TS) | local, S3, GCS, Azure. No consumer clouds | none | in process | young, small community | MIT | small, pure JS |
| Nango, self-hosted | an OAuth broker and API proxy for hundreds of APIs; files only through each API's own calls | a server with PostgreSQL and Redis, which also stores the tokens itself (outside our vault) | self-hosted | mature product, but self-hosting is a reduced edition | source-available (to check before any use), not OSI | a service |

**Why OpenDAL.** It is the only option that covers the consumer clouds **and** runs in process with nothing to operate, under an OSI licence. rclone covers more, but it is a service to run, and it would hold secrets outside the vault. FTP, SFTP, pCloud and iCloud would justify rclone or another library the day a real customer asks; they are not in the first wave.

### Decision

1. **One OpenDAL-backed adapter behind the port** (`opendalStore`, `@krizaka/storage/opendal`) for every provider that has no adapter of its own. These are the user clouds (Google Drive, OneDrive, Dropbox) and the long tail of admin object stores (Azure Blob, GCS, B2, Swift, WebDAV). A new provider is a line of `OPENDAL_SERVICES` (and, for OAuth, a line of `CLOUD_CONNECTORS`). It is never a new adapter.
2. **We keep the existing adapters where OpenDAL is worse:**
   - **`bucketStore` (S3).** It passes the same contract with no native module and no SDK. Its HTTP goes through our injected `fetch`, so tests fake it and a product can pin egress. It is edge-safe, and it adds 0 MB against 60–80 MB. OpenDAL's `s3` passes the same contract, so it is the fallback the day `bucketStore` lacks something (multipart above the single-call size, for example).
   - **`remoteStore` (Bunny).** OpenDAL has no Bunny service.
   - **`folderStore`.** It is dev only, and has no reason to change.
3. **The hand-written `dropboxStore` and `dropbox-oauth.ts` (krizaka-ts#221) are superseded** by OpenDAL `dropbox` with `CLOUD_CONNECTORS.dropbox`. They stay exported until Yomizaka's connection screen ships on the new path, then a major release removes them.
4. **Arctic for user connectors.** We use its generic `OAuth2Client` over the `CLOUD_CONNECTORS` table, with PKCE S256 for every provider (even with a client secret), and refresh tokens sealed with the vault. A provider's rotated refresh token is resealed (`onRotate`). Revocation is tried at the provider where it exists; the sealed token is always deleted. The PKCE verifier rides sealed in the OAuth `state` record (no table), as noted on yomizaka#530.
5. **Login providers are a separate concern.**
   - **Java services sign people in through Spring Security OAuth2 Client.** Each provider is one `ClientRegistration` (from `spring.security.oauth2.client.registration.<id>`, `CommonOAuth2Provider` for Google, GitHub and Facebook, Apple declared as its own registration). The user mapping is a map from `registrationId` to a mapper. There is **no if-ladder on the provider name** (the code audit, krizaka/.github#384).
   - TS apps keep `@krizaka/auth`, and identity lives in krizaka-users ([.github ADR-001](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-001-krizaka-accounts.md)).
   - A storage connection never signs anyone in, and a sign-in never grants file access.

### Provider credentials and krizaka/.github ADR-001 (accounts)

.github ADR-001 takes **passwords** out of the products' PostgreSQL: identity lives in krizaka-users. ADR-005 keeps **provider credentials** in the product's database. The two align, for these reasons:

- **They are not identity.** No login password, session or identity token is ever stored by `@krizaka/storage`. What it stores is an integration secret: the S3 keys an admin typed, or the refresh token a person granted for an app folder. Each one belongs to a provider row, with the row's audit trail.
- **A database dump alone opens nothing.** Each value is an envelope (`v2.<key_id>.<wrapped data key>.<sealed secret>`, AES-256-GCM). The key-encryption key is **never in PostgreSQL**: `MEDIA_VAULT_KEY` lives in the deployment's secret store (App Platform secrets), with a backup copy outside the deployment. A dump, a replica or a backup of the database holds ciphertext and wrapped keys only.
- **Rotation.**
  - The key-encryption key rotates with `rewrapEnvelope`: the keyring holds the old and the new `key_id`, the data keys are re-wrapped, and nobody retypes a credential.
  - A provider's own rotation (Microsoft and Google rotate refresh tokens) is resealed at once through `onRotate`.
  - A person or an admin can revoke at any time, and the sealed value is then deleted.
- **The path to an external secret manager.** The `Keyring` is the seam. Today it is in-process keys by `key_id`. The next step turns it into a port, `{ wrap(dataKey) → { keyId, wrapped }, unwrap(keyId, wrapped) → dataKey }`, so that a KMS (AWS KMS `ca-central-1`, OVHcloud KMS, or Vault's transit engine) holds the key-encryption key and the process never sees it.
  - The stored format does not change: the `key_id` names the KMS key.
  - The migration is a re-wrap, which the move tooling already does.
  - Once a KMS holds the key-encryption key, `MEDIA_VAULT_KEY` disappears from the environment.

### Private providers register without touching the open-source core

Enterprise integrations (a customer's document management system, a sovereign provider under contract) live in **private repositories**. The port lets them in like this:

- **The registry becomes a value, not a constant.** `createProviderRegistry({ kinds, adapters })` starts from the public `PROVIDER_KINDS` and the public adapters (`bucketStore`, `remoteStore`, `opendalStore`…). A private package exports `{ kind: ProviderKind, open: (coordinates, credentials, ctx) => ObjectStore }`. The product composes them at its edge (Yomizaka's `app/storage-providers.ts`): `createProviderRegistry(...).with(acmeDms)`.
- **One registry for everything.** `openProvider`, `createProviderService` and the admin API receive that registry, so the admin screen lists the private kind with its fields like any other.
- **The rules apply to every kind, private ones included.** The registry applies the scopes, runtimes, `devOnly`, the endpoint and DNS checks of `url` fields, the sealing of `secret` fields and the audit.
  - A private kind cannot widen them, and it cannot reuse a public kind's name (the registry refuses duplicates).
  - It proves itself with the public `objectStoreContract`, in its own repository's CI.
- **No code is loaded from settings.** The product's build decides which kinds exist, and the admin only chooses among them. The open-source core never names a private package.

### Slices (amended)

- **krizaka-ts (new, after this pull request):** the registry opens the OpenDAL kinds (`google-drive`, `onedrive`, then `azblob`, `gcs`, `b2` and `webdav` at admin scope, through `opendalStore`); `createProviderRegistry` with private-kind registration; the `Keyring` port. Each one comes with its tests.
- **yomizaka#530 rewritten: « user cloud connection, provider-agnostic ».** It is one connect screen and one flow over `CLOUD_CONNECTORS`: Dropbox, Google Drive and OneDrive in the first wave, then any line the table gains. Next come Box (an Arctic line, but no OpenDAL service: it waits) and S3 keys at user scope (`bucketStore`, already done). pCloud, iCloud and SFTP are not in OpenDAL's npm build, so they wait for a real request. The flow covers: the admin's `storage.userConnectors` policy, connect (PKCE, sealed refresh token), « Kept: your <cloud> », disconnect and revoke, and `STORAGE_DISCONNECTED` handling in reads, export and erasure. The app registration steps per provider are written for Oussama in the pull request.
- Google Drive and OneDrive leave « later »: they are lines of data now, not slices of their own.
