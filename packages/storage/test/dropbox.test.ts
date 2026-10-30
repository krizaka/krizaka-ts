import { describe, expect, it } from "vitest";

import {
  dropboxAuthorizeUrl,
  dropboxStore,
  exchangeDropboxCode,
  type FetchLike,
  openProvider,
  pkcePair,
  refreshDropboxToken,
  revokeDropbox,
} from "../src/node";
import { objectStoreContract } from "../src/testkit";

interface Arg {
  path: string;
  cursor: { session_id: string; offset: number };
  commit: { path: string };
}

/** A fake Dropbox: OAuth token endpoint, upload (single call and sessions), download, metadata, delete and list. */
function fakeDropbox(options: { revoked?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const sessions = new Map<string, Uint8Array[]>();
  const log: string[] = [];
  const call: FetchLike = async (url, init) => {
    const u = new URL(url);
    log.push(u.pathname);
    const reply = (status: number, body: unknown = "", bytes?: Uint8Array) => {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      return {
        ok: status < 300,
        status,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array(bytes ?? new TextEncoder().encode(text)).buffer as ArrayBuffer,
        text: async () => text,
      };
    };
    const text = init.body ? new TextDecoder().decode(init.body) : "";
    if (u.pathname === "/oauth2/token")
      return options.revoked
        ? reply(400, { error: "invalid_grant" })
        : reply(200, {
            access_token: "AT",
            refresh_token: text.includes("authorization_code") ? "RT" : undefined,
            expires_in: 14400,
          });
    if (init.headers.authorization !== "Bearer AT") return reply(401);
    const arg = init.headers["dropbox-api-arg"]
      ? (JSON.parse(init.headers["dropbox-api-arg"]) as Arg)
      : text
        ? (JSON.parse(text) as Arg)
        : ({} as Arg);
    const notFound = () => reply(409, { error_summary: "path/not_found/.." });
    switch (u.pathname) {
      case "/2/files/upload":
        files.set(arg.path.toLowerCase(), new Uint8Array(init.body ?? []));
        return reply(200, {});
      case "/2/files/upload_session/start":
        sessions.set("s1", [new Uint8Array(init.body ?? [])]);
        return reply(200, { session_id: "s1" });
      case "/2/files/upload_session/append_v2":
        sessions.get(arg.cursor.session_id)!.push(new Uint8Array(init.body ?? []));
        return reply(200);
      case "/2/files/upload_session/finish": {
        const parts = [...sessions.get(arg.cursor.session_id)!, new Uint8Array(init.body ?? [])];
        files.set(arg.commit.path.toLowerCase(), new Uint8Array(Buffer.concat(parts)));
        return reply(200, {});
      }
      case "/2/files/download":
        return files.has(arg.path.toLowerCase()) ? reply(200, "", files.get(arg.path.toLowerCase())) : notFound();
      case "/2/files/get_metadata":
        return files.has(arg.path.toLowerCase())
          ? reply(200, { size: files.get(arg.path.toLowerCase())!.length })
          : notFound();
      case "/2/files/delete_v2":
        return files.delete(arg.path.toLowerCase()) ? reply(200, {}) : notFound();
      case "/2/files/list_folder": {
        const root = arg.path.toLowerCase();
        const entries = [...files]
          .filter(([p]) => p.startsWith(`${root}/`))
          .map(([p, b]) => ({ ".tag": "file", path_display: p, size: b.length }));
        return reply(200, { entries, has_more: false, cursor: "c" });
      }
      case "/2/auth/token/revoke":
        return reply(200, {});
      default:
        return reply(404);
    }
  };
  return { call, files, log, sessions };
}

const clock = { now: () => new Date("2026-10-28T12:00:00Z") };
const make = () =>
  dropboxStore({ clientId: "cid", refreshToken: "RT", prefix: "yomizaka", fetch: fakeDropbox().call, clock });

objectStoreContract("dropbox", make);

describe("dropboxStore", () => {
  it("has no signed link and no public link: the app streams the file", async () => {
    const store = make();
    expect(await store.signedUrl("a/b.pdf", 900)).toBeNull();
    expect(store.publicUrl("a/b.pdf")).toBeNull();
  });

  it("renews the access token once while it is valid", async () => {
    const dbx = fakeDropbox();
    const store = dropboxStore({ clientId: "cid", refreshToken: "RT", fetch: dbx.call, clock });
    await store.put("a/1.txt", new Uint8Array([1]), { contentType: "text/plain" });
    await store.get("a/1.txt");
    expect(dbx.log.filter((p) => p === "/oauth2/token")).toHaveLength(1);
  });

  it("answers STORAGE_DISCONNECTED when the connection was revoked, and touches nothing", async () => {
    const dbx = fakeDropbox({ revoked: true });
    const store = dropboxStore({ clientId: "cid", refreshToken: "RT", fetch: dbx.call, clock });
    await expect(store.get("a/1.txt")).rejects.toMatchObject({ code: "STORAGE_DISCONNECTED" });
    await expect(store.delete("a/1.txt")).rejects.toMatchObject({ code: "STORAGE_DISCONNECTED" });
    expect(dbx.files.size).toBe(0);
  });

  it("uploads a large file through a session, in chunks, and reads it back whole", async () => {
    const dbx = fakeDropbox();
    const store = dropboxStore({ clientId: "cid", refreshToken: "RT", fetch: dbx.call, clock });
    const big = new Uint8Array(150 * 1024 * 1024 + 5).fill(7);
    await store.put("big/file.bin", big, { contentType: "application/octet-stream" });
    expect(dbx.log).toContain("/2/files/upload_session/start");
    expect(dbx.log).toContain("/2/files/upload_session/finish");
    expect(dbx.log).not.toContain("/2/files/upload");
    expect((await store.head("big/file.bin"))?.size).toBe(big.length);
  }, 60_000);
});

describe("Dropbox OAuth 2 with PKCE", () => {
  it("makes a verifier and its S256 challenge, and an authorize URL asking for an offline token", () => {
    const { verifier, challenge } = pkcePair(() => new Uint8Array(32).fill(1));
    expect(verifier).toHaveLength(43);
    expect(challenge).not.toBe(verifier);
    const url = new URL(
      dropboxAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.example.com/cb", challenge, state: "st" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "cid",
      response_type: "code",
      code_challenge_method: "S256",
      token_access_type: "offline",
      state: "st",
      code_challenge: challenge,
    });
  });

  it("exchanges the code, refreshes, revokes; a revoked refresh token is STORAGE_DISCONNECTED", async () => {
    const dbx = fakeDropbox();
    expect(
      await exchangeDropboxCode(dbx.call, {
        clientId: "cid",
        code: "c",
        verifier: "v",
        redirectUri: "https://app.example.com/cb",
      }),
    ).toMatchObject({ accessToken: "AT", refreshToken: "RT" });
    expect(await refreshDropboxToken(dbx.call, { clientId: "cid", refreshToken: "RT" })).toMatchObject({
      accessToken: "AT",
    });
    await expect(revokeDropbox(dbx.call, "AT")).resolves.toBeUndefined();
    await expect(
      refreshDropboxToken(fakeDropbox({ revoked: true }).call, { clientId: "cid", refreshToken: "RT" }),
    ).rejects.toMatchObject({ code: "STORAGE_DISCONNECTED" });
  });

  it("opens as a registered kind with no claim about where the files are", async () => {
    const opened = await openProvider(
      "dropbox",
      { clientId: "cid" },
      { refreshToken: "RT" },
      { runtime: "server", environment: "prod", fetch: fakeDropbox().call, clock },
    );
    expect(opened.residency.key).toBe("user-cloud");
  });
});
