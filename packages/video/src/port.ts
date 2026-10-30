/**
 * The ports of « video »: one interface for uploading, playing and tracking videos, named by what it does. Generic: no vendor SDK
 * (an adapter speaks plain HTTP through an injected `fetch`), no environment variable (keys come in as parameters), no wall clock.
 * The CLIENT never holds a library key: the server signs a short-lived upload session and a short-lived view token.
 */
export type { Clock } from "@krizaka/db";

/** The part of `fetch` the adapters use: inject the global one (`fetch`), or a fake in a test. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Where a client uploads, resumably (TUS), and the headers it must send: short-lived, for this video only. */
export interface UploadSession {
  videoId: string;
  endpoint: string;
  headers: Record<string, string>;
  /** Unix seconds. */
  expires: number;
}

/** A token the player is given for one video. `expires` is Unix seconds. */
export interface ViewToken {
  token: string;
  expires: number;
}

export interface PlaybackUrls {
  /** The playlist, signed for the whole video directory when the zone has token authentication (the token sits in the path, so every segment is covered). */
  hls: string;
  /** A signed link to the poster. */
  poster: string;
}

export const VIDEO_STATUS = {
  queued: "queued",
  processing: "processing",
  encoding: "encoding",
  ready: "ready",
  playable: "playable",
  failed: "failed",
  uploading: "uploading",
  uploaded: "uploaded",
  uploadFailed: "upload_failed",
  captions: "captions_generated",
  metadata: "metadata_generated",
} as const;
export type VideoStatus = (typeof VIDEO_STATUS)[keyof typeof VIDEO_STATUS];

/** What a provider's webhook says happened to one video. */
export interface VideoEvent {
  videoId: string;
  status: VideoStatus;
  /** The provider's own code, for logs. */
  raw: number;
}

/** One video provider. Every adapter runs `videoProviderContract` (`@krizaka/video/testkit`). */
export interface VideoProvider {
  readonly name: string;
  /** Creates the video record and answers its id. */
  createVideo(input: { title: string; collectionId?: string }): Promise<{ videoId: string }>;
  /** A server-signed resumable upload for an existing video, valid `ttlSeconds` (a few minutes up to a few hours for a big file). */
  uploadSession(videoId: string, ttlSeconds: number): UploadSession;
  /** A token for the embedded player, valid `ttlSeconds` (1 to 5 minutes is the norm). */
  viewToken(videoId: string, ttlSeconds: number, surface: "embed" | "mobile"): ViewToken;
  playbackUrls(videoId: string, ttlSeconds: number): PlaybackUrls;
  deleteVideo(videoId: string): Promise<boolean>;
  /** Verifies a webhook against the raw body and answers the event, or `null` for a status we do not track. @throws VideoError when the signature is wrong. */
  parseWebhook(rawBody: string, headers: Record<string, string | null | undefined>): VideoEvent | null;
}

export const VIDEO_CODE = {
  badConfig: "VIDEO_BAD_CONFIG",
  badInput: "VIDEO_BAD_INPUT",
  provider: "VIDEO_PROVIDER_FAILED",
  badWebhook: "VIDEO_BAD_WEBHOOK",
} as const;
export type VideoCode = (typeof VIDEO_CODE)[keyof typeof VIDEO_CODE];

export class VideoError extends Error {
  constructor(
    readonly code: VideoCode,
    message: string,
  ) {
    super(message);
    this.name = "VideoError";
  }
}
