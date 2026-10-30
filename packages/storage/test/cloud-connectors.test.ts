import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CLOUD_CONNECTORS,
  cloudConnector,
  connectionAccessToken,
  type ConnectorApp,
  finishConnection,
  refreshConnection,
  revokeConnection,
  startConnection,
} from "../src/cloud-connectors";
import { openEnvelope, sealEnvelope } from "../src/vault";

/** A fake OAuth 2 server: issues a code for a PKCE challenge, checks the verifier, rotates refresh tokens, revokes (RFC 7009 and bearer). */
function fakeOAuth() {
  const codes = new Map<string, string>(); // code -> challenge
  const live = new Set<string>(); // refresh tokens still valid
  const revoked: string[] = [];
  let issued = 0;
  const issue = () => {
    issued += 1;
    const refresh = `refresh-${issued}`;
    live.add(refresh);
    return { access_token: `access-${issued}`, refresh_token: refresh, token_type: "bearer", expires_in: 3600 };
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const send = (status: number, json: unknown) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
      if (req.url === "/token" && body.get("grant_type") === "authorization_code") {
        const challenge = codes.get(body.get("code") ?? "");
        const verifier = body.get("code_verifier") ?? "";
        if (!challenge || createHash("sha256").update(verifier).digest("base64url") !== challenge)
          return send(400, { error: "invalid_grant" });
        codes.delete(body.get("code")!);
        return send(200, issue());
      }
      if (req.url === "/token" && body.get("grant_type") === "refresh_token") {
        const refresh = body.get("refresh_token") ?? "";
        if (!live.delete(refresh)) return send(400, { error: "invalid_grant" });
        return send(200, issue());
      }
      if (req.url === "/revoke") {
        live.delete(body.get("token") ?? "");
        revoked.push(`rfc7009:${body.get("token")}`);
        return res.writeHead(200).end();
      }
      if (req.url === "/bearer-revoke") {
        revoked.push(`bearer:${req.headers.authorization}`);
        return res.writeHead(200).end("null");
      }
      res.writeHead(404).end();
    });
  });
  return {
    server,
    revoked,
    /** What the provider does when the person consents: a code bound to the challenge of the authorize URL. */
    consent(authorizeUrl: string) {
      const challenge = new URL(authorizeUrl).searchParams.get("code_challenge")!;
      const code = `code-${codes.size + 1}-${randomBytes(4).toString("hex")}`;
      codes.set(code, challenge);
      return code;
    },
    expire: () => live.clear(),
  };
}

describe("cloud connectors through Arctic (authorization code + PKCE, refresh, revocation)", () => {
  const oauth = fakeOAuth();
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((done) => oauth.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(oauth.server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => oauth.server.close(() => done())));
  const app: ConnectorApp = {
    clientId: "demo-client",
    clientSecret: "demo-secret",
    redirectUri: "https://app.example.test/connect/callback",
  };
  const fake = (name: keyof typeof CLOUD_CONNECTORS, style: "rfc7009" | "bearer" = "rfc7009") =>
    cloudConnector(name, {
      authorize: `${base}/authorize`,
      token: `${base}/token`,
      revoke: { style, url: `${base}/${style === "bearer" ? "bearer-revoke" : "revoke"}` },
    });

  it("each provider is a line of data with its narrowest file scope and its OpenDAL service", () => {
    expect(Object.keys(CLOUD_CONNECTORS)).toEqual(["dropbox", "google-drive", "onedrive"]);
    expect(CLOUD_CONNECTORS["google-drive"].scopes).toEqual(["https://www.googleapis.com/auth/drive.file"]);
    expect(CLOUD_CONNECTORS.onedrive.scopes).toContain("Files.ReadWrite.AppFolder");
    expect(CLOUD_CONNECTORS.dropbox.files).toBe("dropbox");
    expect(() => cloudConnector("myspace")).toThrow(expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }));
  });

  for (const name of ["dropbox", "google-drive", "onedrive"] as const) {
    it(`${name}: authorize URL with S256 PKCE and the provider's extras`, () => {
      const { url, state, verifier } = startConnection(cloudConnector(name), app);
      const params = new URL(url).searchParams;
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
      expect(params.get("state")).toBe(state);
      expect(params.get("redirect_uri")).toBe(app.redirectUri);
      for (const [key, value] of Object.entries(CLOUD_CONNECTORS[name].extra)) expect(params.get(key)).toBe(value);
    });
  }

  it("exchanges the code with the verifier, seals the refresh token in the vault, refreshes and revokes", async () => {
    const connector = fake("google-drive");
    const { url, verifier } = startConnection(connector, app);
    const tokens = await finishConnection(connector, app, { code: oauth.consent(url), verifier });
    expect(tokens.accessToken).toMatch(/^access-/);

    const kek = randomBytes(32);
    const sealed = sealEnvelope(tokens.refreshToken!, kek, "k1");
    expect(sealed).not.toContain(tokens.refreshToken!);
    const refreshToken = openEnvelope(sealed, { keys: { k1: kek } });

    const renewed = await refreshConnection(connector, app, refreshToken);
    expect(renewed.refreshToken).not.toBe(refreshToken); // rotated
    await expect(refreshConnection(connector, app, refreshToken)).rejects.toMatchObject({
      code: "STORAGE_DISCONNECTED",
    });

    await revokeConnection(connector, app, renewed.refreshToken!);
    expect(oauth.revoked).toContain(`rfc7009:${renewed.refreshToken}`);
    await expect(refreshConnection(connector, app, renewed.refreshToken!)).rejects.toMatchObject({
      code: "STORAGE_DISCONNECTED",
    });
  });

  it("a wrong verifier is refused (PKCE), as a lost connection", async () => {
    const connector = fake("dropbox", "bearer");
    const { url } = startConnection(connector, app);
    await expect(
      finishConnection(connector, app, {
        code: oauth.consent(url),
        verifier: "not-the-verifier-not-the-verifier-0123456789",
      }),
    ).rejects.toMatchObject({ code: "STORAGE_DISCONNECTED" });
  });

  it("Dropbox revokes with the access token as a bearer; OneDrive has no endpoint and only forgets", async () => {
    await revokeConnection(fake("dropbox", "bearer"), app, "access-x");
    expect(oauth.revoked).toContain("bearer:Bearer access-x");
    await expect(
      revokeConnection(cloudConnector("onedrive", { token: `${base}/token` }), app, "access-y"),
    ).resolves.toBeUndefined();
  });

  it("connectionAccessToken caches until a minute before expiry, reseals a rotated token, then reports the disconnect", async () => {
    const connector = fake("onedrive");
    const { url, verifier } = startConnection(connector, app);
    const first = await finishConnection(connector, app, { code: oauth.consent(url), verifier });
    let now = new Date("2026-10-28T12:00:00Z");
    const rotated: string[] = [];
    const token = connectionAccessToken({
      connector,
      app,
      refreshToken: first.refreshToken!,
      clock: { now: () => now },
      onRotate: async (t) => void rotated.push(t),
    });
    const a = await token();
    expect(await token()).toBe(a); // cached
    expect(rotated).toHaveLength(1);
    now = new Date("2026-10-28T14:00:00Z");
    oauth.expire();
    await expect(token()).rejects.toMatchObject({ code: "STORAGE_DISCONNECTED" });
  });

  it("an unreachable provider is a provider failure, not a disconnect", async () => {
    const connector = cloudConnector("dropbox", { token: "http://127.0.0.1:1/token" });
    await expect(refreshConnection(connector, app, "refresh-z")).rejects.toMatchObject({
      code: "STORAGE_PROVIDER_FAILED",
    });
  });
});
