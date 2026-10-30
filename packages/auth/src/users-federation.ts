import {
  type CompleteOptions,
  type ExternalIdentity,
  type FederatedProvider,
  FEDERATION_CODE,
  FederationError,
  type IdentityProvider,
  isFederatedProvider,
  isLocalReturn,
  type StartedSignIn,
  type StartOptions,
} from "./federation";

/** The `fetch` the adapter calls krizaka-users with (injected: no global, no network in tests). */
export type Fetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface UsersFederationOptions {
  /** The tenant host of the product: `https://auth.dev.akinaza.com`. */
  baseUrl: string;
  /** The product's public address: the start URL sends the person back to it, so `returnTo` is absolute from it. */
  appUrl: string;
  fetch: Fetcher;
}

const START = (base: string, provider: FederatedProvider) => `${base}/api/v1/auth/web/${provider}/start`;
const EXCHANGE = (base: string) => `${base}/api/v1/auth/web/exchange`;

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** Reads krizaka-users' answer into an identity; anything that is not a complete identity is refused. */
export function parseExternalIdentity(body: unknown): ExternalIdentity {
  const o = (body ?? {}) as Record<string, unknown>;
  const issuer = text(o.issuer);
  const subject = text(o.subject);
  if (!issuer || !subject)
    throw new FederationError(FEDERATION_CODE.unavailable, "krizaka-users answered without an issuer and a subject");
  return { issuer, subject, email: text(o.email), emailVerified: o.email_verified === true, name: text(o.name) };
}

/**
 * The adapter for krizaka-users (`auth.<product>` tenant host, krizaka/krizaka-users#31): `start` builds the tenant's start address,
 * `complete` exchanges the one-time code (and the PKCE verifier of a native app) for the verified identity.
 */
export function usersIdentityProvider({ baseUrl, appUrl, fetch }: UsersFederationOptions): IdentityProvider {
  const base = baseUrl.replace(/\/+$/, "");
  const app = appUrl.replace(/\/+$/, "");
  return {
    async start(provider, returnTo, options: StartOptions = {}): Promise<StartedSignIn> {
      if (!isFederatedProvider(provider))
        throw new FederationError(FEDERATION_CODE.unknownProvider, `Unknown provider ${String(provider)}`);
      if (!isLocalReturn(returnTo))
        throw new FederationError(FEDERATION_CODE.badReturn, "That return address is not allowed");
      const state = crypto.randomUUID();
      const query = new URLSearchParams({ return_to: `${app}${returnTo}`, state });
      if (options.codeChallenge) {
        query.set("code_challenge", options.codeChallenge);
        query.set("code_challenge_method", "S256");
      }
      return { url: `${START(base, provider)}?${query}`, state };
    },
    async complete(code, options: CompleteOptions = {}) {
      const response = await fetch(EXCHANGE(base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, ...(options.codeVerifier ? { code_verifier: options.codeVerifier } : {}) }),
      });
      if (response.status === 400 || response.status === 401 || response.status === 404 || response.status === 410)
        throw new FederationError(FEDERATION_CODE.invalidCode, "That code is not valid");
      if (!response.ok)
        throw new FederationError(FEDERATION_CODE.unavailable, `krizaka-users answered ${response.status}`);
      return parseExternalIdentity(await response.json());
    },
  };
}
