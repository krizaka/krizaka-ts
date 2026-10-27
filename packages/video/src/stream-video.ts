import { createHmac, timingSafeEqual } from "node:crypto";

import { type Clock, type FetchLike, VIDEO_CODE, VIDEO_STATUS, VideoError, type VideoEvent, type VideoProvider, type VideoStatus } from "./port";
import { embedToken, mobileViewToken, signedDirectoryUrl, signedFileUrl, tusSignature } from "./signing";

export interface StreamVideoOptions {
  /** The numeric id of the video library. */
  libraryId: string;
  /** The library API key: creates and deletes videos, signs uploads and mobile tokens. Server only. */
  apiKey: string;
  /** The « Token authentication key » of the library and its pull zone: signs the embed token and the CDN links. */
  tokenKey: string;
  /** The library's read-only API key: the key of the webhook signature. */
  readOnlyKey: string;
  /** The pull zone's host (`vz-123.b-cdn.net`). */
  cdnHostname: string;
  /** Default `https://video.bunnycdn.com`. */
  apiUrl?: string;
  fetch: FetchLike;
  clock: Clock;
}

// @fixed: the status codes of the provider's webhook, from its documentation (« Webhooks »)
const STATUS: Record<number, VideoStatus> = {
  0: VIDEO_STATUS.queued,
  1: VIDEO_STATUS.processing,
  2: VIDEO_STATUS.encoding,
  3: VIDEO_STATUS.ready,
  4: VIDEO_STATUS.playable,
  5: VIDEO_STATUS.failed,
  6: VIDEO_STATUS.uploading,
  7: VIDEO_STATUS.uploaded,
  8: VIDEO_STATUS.uploadFailed,
  9: VIDEO_STATUS.captions,
  10: VIDEO_STATUS.metadata,
};

const ID = /^[0-9a-zA-Z-]{1,64}$/;
const badInput = (why: string) => new VideoError(VIDEO_CODE.badInput, why);
const checkId = (videoId: string) => {
  if (!ID.test(videoId)) throw badInput("a video id is a GUID");
  return videoId;
};

/** Bunny Stream, behind the `VideoProvider` port. */
export function streamVideo(options: StreamVideoOptions): VideoProvider {
  const api = (options.apiUrl ?? "https://video.bunnycdn.com").replace(/\/+$/, "");
  const headers = { AccessKey: options.apiKey, accept: "application/json", "content-type": "application/json" };
  const nowSeconds = () => Math.floor(options.clock.now().valueOf() / 1000);
  const ttl = (seconds: number) => {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) throw badInput("ttlSeconds is 1 to 86400");
    return seconds;
  };
  return {
    name: "stream",
    async createVideo(input) {
      const res = await options.fetch(`${api}/library/${options.libraryId}/videos`, { method: "POST", headers, body: JSON.stringify({ title: input.title, ...(input.collectionId ? { collectionId: input.collectionId } : {}) }) });
      if (!res.ok) throw new VideoError(VIDEO_CODE.provider, `the video service refused the creation (${res.status})`);
      const guid = (JSON.parse(await res.text()) as { guid?: unknown }).guid;
      if (typeof guid !== "string") throw new VideoError(VIDEO_CODE.provider, "the video service answered no id");
      return { videoId: guid };
    },
    uploadSession(videoId, ttlSeconds) {
      const expires = nowSeconds() + ttl(ttlSeconds);
      checkId(videoId);
      return {
        videoId,
        endpoint: `${api}/tusupload`,
        expires,
        headers: { AuthorizationSignature: tusSignature({ libraryId: options.libraryId, apiKey: options.apiKey, expires, videoId }), AuthorizationExpire: String(expires), VideoId: videoId, LibraryId: options.libraryId },
      };
    },
    viewToken(videoId, ttlSeconds, surface) {
      const expires = nowSeconds() + ttl(ttlSeconds);
      checkId(videoId);
      return { expires, token: surface === "embed" ? embedToken({ tokenKey: options.tokenKey, videoId, expires }) : mobileViewToken({ apiKey: options.apiKey, videoId, expires }) };
    },
    playbackUrls(videoId, ttlSeconds) {
      const expires = nowSeconds() + ttl(ttlSeconds);
      checkId(videoId);
      return {
        hls: signedDirectoryUrl({ hostname: options.cdnHostname, directory: `/${videoId}/`, file: "playlist.m3u8", tokenKey: options.tokenKey, expires }),
        poster: signedFileUrl({ hostname: options.cdnHostname, path: `/${videoId}/thumbnail.jpg`, tokenKey: options.tokenKey, expires }),
      };
    },
    async deleteVideo(videoId) {
      const res = await options.fetch(`${api}/library/${options.libraryId}/videos/${checkId(videoId)}`, { method: "DELETE", headers });
      if (res.status === 404) return false;
      if (!res.ok) throw new VideoError(VIDEO_CODE.provider, `the video service refused the delete (${res.status})`);
      return true;
    },
    parseWebhook(rawBody, received): VideoEvent | null {
      const lower = Object.fromEntries(Object.entries(received).map(([k, v]) => [k.toLowerCase(), v]));
      const signature = lower["x-bunnystream-signature"];
      if (lower["x-bunnystream-signature-version"] !== "v1" || lower["x-bunnystream-signature-algorithm"] !== "hmac-sha256" || typeof signature !== "string") throw new VideoError(VIDEO_CODE.badWebhook, "the signature headers are missing");
      const expected = createHmac("sha256", options.readOnlyKey).update(rawBody).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new VideoError(VIDEO_CODE.badWebhook, "the signature does not match");
      let body: { VideoLibraryId?: unknown; VideoGuid?: unknown; Status?: unknown };
      try {
        body = JSON.parse(rawBody) as typeof body;
      } catch {
        throw new VideoError(VIDEO_CODE.badWebhook, "the body is not JSON");
      }
      if (String(body.VideoLibraryId) !== options.libraryId || typeof body.VideoGuid !== "string" || typeof body.Status !== "number") throw new VideoError(VIDEO_CODE.badWebhook, "the body is not this library's event");
      const status = STATUS[body.Status];
      return status ? { videoId: body.VideoGuid, status, raw: body.Status } : null;
    },
  };
}
