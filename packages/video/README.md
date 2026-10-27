# @krizaka/video

Video behind one port: server-signed resumable uploads, playback tokens and signed links, webhook statuses. Bunny Stream is the first adapter (`streamVideo`); the port is open to others. The client never holds a library key. No vendor SDK, no environment variable, no wall clock.

- **Uploads.** `createVideo` then `uploadSession(videoId, ttl)`: a TUS endpoint and the four headers (`AuthorizationSignature`, `AuthorizationExpire`, `VideoId`, `LibraryId`), signed on the server for this video only.
- **Playback.** `viewToken(videoId, ttl, "embed" | "mobile")` (the embedded web player's token, or the mobile SDKs'; the lifetime is passed in, 1 to 5 minutes is the norm) and `playbackUrls(videoId, ttl)`: the HLS playlist signed for the whole video directory (the token sits in the path, so every rendition and segment is covered) and a signed poster.
- **Webhooks.** `parseWebhook(rawBody, headers)` verifies the HMAC-SHA256 of the raw body with the library's read-only key, in constant time, and answers `{ videoId, status }` (`ready`, `playable`, `failed`, `upload_failed`…); a status it does not track answers `null`.
- **Proofs.** The formulas come from Bunny's documentation (TUS, embedded view token, mobile SDK token, webhooks) and the CDN forms are the ones Orochia runs in production. The documentation publishes no expected outputs, so the tests compute them independently from the documented formulas and never use an invented vector.
- **Not here yet.** Captions, collections and listing are follow-ups.

```ts
import { streamVideo } from "@krizaka/video";

const video = streamVideo({ libraryId, apiKey, tokenKey, readOnlyKey, cdnHostname, fetch, clock });
const { videoId } = await video.createVideo({ title: "Moment" });
const session = video.uploadSession(videoId, 3600); // hand it to the client's TUS uploader
const { token, expires } = video.viewToken(videoId, 120, "embed");
```

`videoProviderContract` (`@krizaka/video/testkit`) is the contract every adapter runs.

Apache-2.0.
