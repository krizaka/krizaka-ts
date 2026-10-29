import { ArcticFetchError, CodeChallengeMethod, generateCodeVerifier, generateState, OAuth2Client, OAuth2RequestError, type OAuth2Tokens } from "arctic";

import { type Clock, STORAGE_CODE, StorageError } from "./port";

/**
 * The clouds a person may connect (ADR-005 amendment, krizaka-ts#235), as data: one line per provider, read by one flow. The OAuth
 * exchanges are Arctic's (`OAuth2Client`: authorization code + PKCE S256, refresh, RFC 7009 revocation); the files are OpenDAL's
 * (`files` is the `opendalStore` service the access token opens). No per-provider code: a new cloud is a line here.
 * - `extra`: the provider's own authorization parameters (Dropbox's offline token, Google's offline access and consent prompt);
 * - `revoke`: `rfc7009` (Arctic), `bearer` (a POST with the access token: Dropbox), or `null` when the provider has no revocation
 *   endpoint (Microsoft: the person removes the app at account.microsoft.com; we forget the token).
 * - `scopes`: the narrowest file access each one offers (an app folder or the files the app created).
 */
export const CLOUD_CONNECTORS = {
  dropbox: {
    authorize: "https://www.dropbox.com/oauth2/authorize",
    token: "https://api.dropboxapi.com/oauth2/token",
    revoke: { style: "bearer", url: "https://api.dropboxapi.com/2/auth/token/revoke" },
    scopes: [],
    extra: { token_access_type: "offline" },
    files: "dropbox",
  },
  "google-drive": {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: { style: "rfc7009", url: "https://oauth2.googleapis.com/revoke" },
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    extra: { access_type: "offline", prompt: "consent" },
    files: "gdrive",
  },
  onedrive: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revoke: null,
    scopes: ["Files.ReadWrite.AppFolder", "offline_access"],
    extra: {},
    files: "onedrive",
  },
} as const satisfies Record<string, CloudConnector>;
export type CloudConnectorName = keyof typeof CLOUD_CONNECTORS;

export interface CloudConnector {
  authorize: string;
  token: string;
  revoke: { style: "rfc7009" | "bearer"; url: string } | null;
  scopes: readonly string[];
  extra: Readonly<Record<string, string>>;
  files: string;
}

/** The app's registration at the provider (from the admin's settings, the secret sealed). `clientSecret` is null for a public client. */
export interface ConnectorApp {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
}

export interface ConnectionTokens {
  accessToken: string;
  /** Sealed (`sealEnvelope`) and stored with the provider row; absent when the provider did not rotate it on a refresh. */
  refreshToken: string | null;
  /** As the provider said it; the caller's clock dates it (`connectionAccessToken`). */
  expiresInSeconds: number;
}

/** Tests point a connector at a fake OAuth server; never built from what a person typed. */
export type ConnectorOverride = Partial<Pick<CloudConnector, "authorize" | "token" | "revoke">>;

export function cloudConnector(name: string, override: ConnectorOverride = {}): CloudConnector {
  const base = (CLOUD_CONNECTORS as Record<string, CloudConnector | undefined>)[name];
  if (!base) throw new StorageError(STORAGE_CODE.badConfig, `Unknown cloud: ${name}`);
  return { ...base, ...override };
}

const clientOf = (app: ConnectorApp) => new OAuth2Client(app.clientId, app.clientSecret, app.redirectUri);

/** An expired, revoked or refused grant is a lost connection; a network or provider failure is not. The message never quotes a token. */
function failureOf(error: unknown, what: string): StorageError {
  if (error instanceof StorageError) return error;
  if (error instanceof OAuth2RequestError && (error.code === "invalid_grant" || error.code === "invalid_token" || error.code === "access_denied")) return new StorageError(STORAGE_CODE.disconnected, "The cloud no longer accepts this connection");
  if (error instanceof ArcticFetchError) return new StorageError(STORAGE_CODE.provider, `The cloud could not be reached for the ${what}`);
  return new StorageError(STORAGE_CODE.provider, `The cloud refused the ${what}`);
}

const tokensOf = (tokens: OAuth2Tokens): ConnectionTokens => ({
  accessToken: tokens.accessToken(),
  refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
  expiresInSeconds: tokens.accessTokenExpiresInSeconds(),
});

/**
 * Step 1: where the person is sent. Keep `verifier` on the server (sealed inside `state`'s record or a short-lived row); compare
 * `state` on the way back. PKCE S256 for every provider, even with a client secret.
 */
export function startConnection(connector: CloudConnector, app: ConnectorApp): { url: string; state: string; verifier: string } {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = clientOf(app).createAuthorizationURLWithPKCE(connector.authorize, state, CodeChallengeMethod.S256, verifier, [...connector.scopes]);
  for (const [name, value] of Object.entries(connector.extra)) url.searchParams.set(name, value);
  return { url: url.toString(), state, verifier };
}

/** Step 2: the code the provider sent back, with the verifier of step 1. The refresh token is what gets sealed. */
export async function finishConnection(connector: CloudConnector, app: ConnectorApp, input: { code: string; verifier: string }): Promise<ConnectionTokens> {
  try {
    const tokens = tokensOf(await clientOf(app).validateAuthorizationCode(connector.token, input.code, input.verifier));
    if (tokens.refreshToken === null) throw new StorageError(STORAGE_CODE.provider, "The cloud gave no refresh token: the connection would not last");
    return tokens;
  } catch (error) {
    throw failureOf(error, "connection");
  }
}

/** A fresh access token. `STORAGE_DISCONNECTED` when the grant was revoked or expired. A rotated refresh token comes back to be resealed. */
export async function refreshConnection(connector: CloudConnector, app: ConnectorApp, refreshToken: string): Promise<ConnectionTokens> {
  try {
    return tokensOf(await clientOf(app).refreshAccessToken(connector.token, refreshToken, []));
  } catch (error) {
    throw failureOf(error, "token renewal");
  }
}

/** The person's disconnect: revoked at the provider where it can be (already revoked is fine); the caller then deletes the sealed token. */
export async function revokeConnection(connector: CloudConnector, app: ConnectorApp, token: string, call: typeof fetch = fetch): Promise<void> {
  if (!connector.revoke) return;
  try {
    if (connector.revoke.style === "rfc7009") return await clientOf(app).revokeToken(connector.revoke.url, token);
    const res = await call(connector.revoke.url, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (!res.ok && res.status !== 401) throw new StorageError(STORAGE_CODE.provider, `The cloud refused the revocation (${res.status})`);
  } catch (error) {
    throw failureOf(error, "revocation");
  }
}

/**
 * The `accessToken` an `opendalStore` asks for: renewed from the refresh token a minute before it expires, the rotated refresh token
 * handed to `onRotate` (to reseal), `STORAGE_DISCONNECTED` once the grant is gone.
 */
export function connectionAccessToken(input: { connector: CloudConnector; app: ConnectorApp; refreshToken: string; clock: Clock; onRotate?: (refreshToken: string) => Promise<void> }): () => Promise<string> {
  let refreshToken = input.refreshToken;
  let access: { token: string; until: number } | null = null;
  // @fixed: renew a minute early so a call never starts with a token about to expire
  const EARLY_SECONDS = 60;
  return async () => {
    const now = input.clock.now().getTime();
    if (access && access.until > now) return access.token;
    const fresh = await refreshConnection(input.connector, input.app, refreshToken);
    if (fresh.refreshToken && fresh.refreshToken !== refreshToken) {
      refreshToken = fresh.refreshToken;
      await input.onRotate?.(refreshToken);
    }
    access = { token: fresh.accessToken, until: now + (fresh.expiresInSeconds - EARLY_SECONDS) * 1000 };
    return access.token;
  };
}
