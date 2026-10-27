import { expect, it } from "vitest";

import type { VideoProvider } from "./port";

/** What every `VideoProvider` must do: the same behaviour behind the same port. `make` gives a provider whose clock reads 2026-10-26T12:00:00Z. */
export function videoProviderContract(name: string, make: () => VideoProvider | Promise<VideoProvider>) {
  const NOW = Math.floor(new Date("2026-10-26T12:00:00Z").valueOf() / 1000);

  it(`${name}: a signed upload session is short-lived and bound to its video, and carries no library key`, async () => {
    const p = await make();
    const { videoId } = await p.createVideo({ title: "Moment" });
    const session = p.uploadSession(videoId, 600);
    expect(session.videoId).toBe(videoId);
    expect(session.expires).toBe(NOW + 600);
    expect(JSON.stringify(session)).not.toMatch(/api-?key|secret/i);
    expect(p.uploadSession(videoId, 600).headers).toEqual(session.headers);
    expect(p.uploadSession(videoId, 601).headers).not.toEqual(session.headers);
    expect(p.uploadSession(`${videoId}x`, 600).headers).not.toEqual(session.headers);
  });

  it(`${name}: a view token expires when asked, differs per video and per surface, and refuses a silly lifetime`, async () => {
    const p = await make();
    const embed = p.viewToken("v-1", 120, "embed");
    expect(embed.expires).toBe(NOW + 120);
    expect(p.viewToken("v-2", 120, "embed").token).not.toBe(embed.token);
    expect(p.viewToken("v-1", 120, "mobile").token).not.toBe(embed.token);
    for (const bad of [0, -5, 1.5, 86_401]) expect(() => p.viewToken("v-1", bad, "embed")).toThrow(expect.objectContaining({ code: "VIDEO_BAD_INPUT" }));
    expect(() => p.viewToken("../etc", 60, "embed")).toThrow(expect.objectContaining({ code: "VIDEO_BAD_INPUT" }));
  });

  it(`${name}: playback links are signed for this video and expire`, async () => {
    const p = await make();
    const urls = p.playbackUrls("v-1", 300);
    expect(urls.hls).toContain("v-1");
    expect(urls.hls).toContain(`expires=${NOW + 300}`);
    expect(urls.poster).toContain(`expires=${NOW + 300}`);
    expect(p.playbackUrls("v-2", 300).hls).not.toBe(urls.hls);
  });
}
