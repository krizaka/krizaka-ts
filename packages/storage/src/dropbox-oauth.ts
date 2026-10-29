import { createHash, randomBytes } from "node:crypto";

import { type FetchLike, STORAGE_CODE, StorageError } from "./port";

const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
const API = "https://api.dropboxapi.com";

/** A PKCE pair (RFC 7636): keep the verifier on the server with the state, send the challenge. The randomness is injected for tests. */
export function pkcePair(random: (bytes: number) => Uint8Array = randomBytes): { verifier: string; challenge: string } {
  const verifier = Buffer.from(random(32)).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The address the person is sent to. `offline` asks for a refresh token; App-folder access is the app's registration, not a scope we widen. */
export function dropboxAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: input.redirectUri,
    state: input.state,
  }).toString();
  return url.toString();
}

const form = (values: Record<string, string>) => new TextEncoder().encode(new URLSearchParams(values).toString());
const FORM = { "content-type": "application/x-www-form-urlencoded" };

async function token(
  call: FetchLike,
  values: Record<string, string>,
): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds: number }> {
  const res = await call(`${API}/oauth2/token`, { method: "POST", headers: FORM, body: form(values) });
  if (res.status === 400 || res.status === 401)
    throw new StorageError(STORAGE_CODE.disconnected, "Dropbox no longer accepts this connection");
  if (!res.ok) throw new StorageError(STORAGE_CODE.provider, `Dropbox refused the token request (${res.status})`);
  const body = JSON.parse(await res.text()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresInSeconds: body.expires_in,
  };
}

/** Exchanges the code Dropbox sent back (with the verifier kept at the start). The refresh token is what gets sealed. */
export const exchangeDropboxCode = (
  call: FetchLike,
  input: { clientId: string; code: string; verifier: string; redirectUri: string },
) =>
  token(call, {
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  });

/** A fresh access token from the refresh token. `STORAGE_DISCONNECTED` when it was revoked or expired. */
export const refreshDropboxToken = (call: FetchLike, input: { clientId: string; refreshToken: string }) =>
  token(call, { grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId });

/** Revokes the connection at Dropbox (the person's disconnect). Already-revoked is fine. */
export async function revokeDropbox(call: FetchLike, accessToken: string): Promise<void> {
  const res = await call(`${API}/2/auth/token/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 401)
    throw new StorageError(STORAGE_CODE.provider, `Dropbox refused the revoke (${res.status})`);
}
