import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { embedToken, type FetchLike, mobileViewToken, signedDirectoryUrl, signedFileUrl, streamVideo, tusSignature, VIDEO_CODE } from "../src";
import { videoProviderContract } from "../src/testkit";

const NOW = new Date("2026-10-26T12:00:00Z");
const sec = Math.floor(NOW.valueOf() / 1000);
const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
const fetch: FetchLike = async (url, init) => {
  calls.push({ url, ...init });
  if (init.method === "POST") return { ok: true, status: 201, text: async () => JSON.stringify({ guid: "0de20000-0000-4000-8000-000000000001" }) };
  return { ok: !url.includes("gone"), status: url.includes("gone") ? 404 : 200, text: async () => "" };
};
const make = (over: Partial<Parameters<typeof streamVideo>[0]> = {}) => streamVideo({ libraryId: "773325", libraryKey: "api-key", tokenKey: "token-key", readOnlyKey: "read-only-key", cdnHostname: "vz-1.b-cdn.net", fetch, clock: { now: () => NOW }, ...over });

videoProviderContract("stream", () => make());

// The documentation gives the formulas, not the expected outputs (checked 2026-10-26): the expected values below are computed
// independently from the documented formula with node:crypto, never copied from a guess.
describe("the signatures, from the documented formulas", () => {
  it("TUS: sha256 hex of libraryId + libraryKey + expires + videoId", () => {
    const expected = createHash("sha256").update("773325api-key1793000000vid-1").digest("hex");
    expect(tusSignature({ libraryId: "773325", libraryKey: "api-key", expires: 1793000000, videoId: "vid-1" })).toBe(expected);
    expect(expected).toHaveLength(64);
  });
  it("embed: sha256 hex of tokenKey + videoId + expires, on the docs' example inputs", () => {
    const key = "4742a81b-bf15-42fe-8b1c-8fcb9024c550";
    const id = "32d140e2-e4f4-4eec-9d53-20371e9be607";
    expect(embedToken({ tokenKey: key, videoId: id, expires: 1623440202 })).toBe(createHash("sha256").update(`${key}${id}1623440202`).digest("hex"));
  });
  it("mobile: base64 of <hmac-sha256 hex>:<expires>, keyed and fed by the api key", () => {
    const token = mobileViewToken({ libraryKey: "k", videoId: "abc123", expires: 1710000000 });
    const sig = createHmac("sha256", "k").update("kabc1231710000000").digest("hex");
    expect(Buffer.from(token, "base64").toString()).toBe(`${sig}:1710000000`);
  });
  it("CDN: one file by query token, a directory by a token in the path (the form run in production)", () => {
    const file = new URL(signedFileUrl({ hostname: "h.b-cdn.net", path: "/g/thumbnail.jpg", tokenKey: "k", expires: 99 }));
    expect(file.searchParams.get("token")).toBe(createHash("sha256").update("k/g/thumbnail.jpg99").digest("base64url"));
    const dir = signedDirectoryUrl({ hostname: "h.b-cdn.net", directory: "/g/", file: "playlist.m3u8", tokenKey: "k", expires: 99 });
    const token = createHash("sha256").update("k/g/99token_path=/g/").digest("base64url");
    expect(dir).toBe(`https://h.b-cdn.net/bcdn_token=${token}&expires=99&token_path=%2Fg%2F/g/playlist.m3u8`);
  });
});

describe("the stream adapter", () => {
  it("creates a video with the library key and answers its guid", async () => {
    calls.length = 0;
    expect(await make().createVideo({ title: "Moment", collectionId: "col-1" })).toEqual({ videoId: "0de20000-0000-4000-8000-000000000001" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://video.bunnycdn.com/library/773325/videos", headers: { AccessKey: "api-key" } });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ title: "Moment", collectionId: "col-1" });
  });
  it("builds the TUS session: the endpoint, the four headers, the signature of the documented formula", () => {
    const s = make().uploadSession("vid-1", 3600);
    expect(s.endpoint).toBe("https://video.bunnycdn.com/tusupload");
    expect(s.headers).toEqual({ AuthorizationSignature: tusSignature({ libraryId: "773325", libraryKey: "api-key", expires: sec + 3600, videoId: "vid-1" }), AuthorizationExpire: String(sec + 3600), VideoId: "vid-1", LibraryId: "773325" });
  });
  it("deletes a video, answering false for one that is gone, and throws on a refusal", async () => {
    expect(await make().deleteVideo("vid-1")).toBe(true);
    expect(await make().deleteVideo("gone")).toBe(false);
    const refuse: FetchLike = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await expect(make({ fetch: refuse }).deleteVideo("vid-1")).rejects.toMatchObject({ code: VIDEO_CODE.provider });
    await expect(make({ fetch: refuse }).createVideo({ title: "x" })).rejects.toMatchObject({ code: VIDEO_CODE.provider });
  });
  it("an expired token is the caller's to check: the expiry is in the token and the clock is injected", () => {
    const later = make({ clock: { now: () => new Date(NOW.valueOf() + 3_600_000) } });
    expect(later.viewToken("vid-1", 60, "embed").expires).toBe(sec + 3600 + 60);
    expect(later.viewToken("vid-1", 60, "embed").token).not.toBe(make().viewToken("vid-1", 60, "embed").token);
  });
});

describe("the webhook", () => {
  const body = JSON.stringify({ VideoLibraryId: 773325, VideoGuid: "657bb740-a71b-4529-a012-528021c31a92", Status: 3 });
  const headers = (signature: string, over: Record<string, string> = {}) => ({ "X-BunnyStream-Signature": signature, "X-BunnyStream-Signature-Version": "v1", "X-BunnyStream-Signature-Algorithm": "hmac-sha256", ...over });
  const sign = (raw: string, key = "read-only-key") => createHmac("sha256", key).update(raw).digest("hex");
  it("verifies the HMAC of the raw body with the read-only key and maps the status", () => {
    expect(make().parseWebhook(body, headers(sign(body)))).toEqual({ videoId: "657bb740-a71b-4529-a012-528021c31a92", status: "ready", raw: 3 });
    for (const [code, status] of [[4, "playable"], [5, "failed"], [8, "upload_failed"]] as const) {
      const raw = JSON.stringify({ VideoLibraryId: 773325, VideoGuid: "g", Status: code });
      expect(make().parseWebhook(raw, headers(sign(raw)))?.status).toBe(status);
    }
  });
  it("answers null for a status it does not track", () => {
    const raw = JSON.stringify({ VideoLibraryId: 773325, VideoGuid: "g", Status: 42 });
    expect(make().parseWebhook(raw, headers(sign(raw)))).toBeNull();
  });
  it("refuses a wrong key, a changed body, missing or wrong headers, another library and a body that is not JSON", () => {
    const p = make();
    expect(() => p.parseWebhook(body, headers(sign(body, "other")))).toThrow(/does not match/);
    expect(() => p.parseWebhook(`${body} `, headers(sign(body)))).toThrow(/does not match/);
    expect(() => p.parseWebhook(body, {})).toThrow(/missing/);
    expect(() => p.parseWebhook(body, headers(sign(body), { "X-BunnyStream-Signature-Version": "v2" }))).toThrow(/missing/);
    const other = JSON.stringify({ VideoLibraryId: 1, VideoGuid: "g", Status: 3 });
    expect(() => p.parseWebhook(other, headers(sign(other)))).toThrow(/library/);
    expect(() => p.parseWebhook("nope", headers(sign("nope")))).toThrow(/JSON/);
  });
});
