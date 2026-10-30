import crypto from "node:crypto";

/**
 * Federated sign-in (Google, Apple, Facebook, a native app's PKCE) delegated to krizaka-users, behind a PORT. The product keeps its
 * own accounts (`postgresAccounts`); this port only answers « who is this person, according to the provider ». An external
 * identity is never a second user table: it is a link to an account the product already has.
 */
export type FederatedProvider = "google" | "apple" | "facebook";

/** The providers the port knows; anything else is refused before it reaches the adapter. */
export const FEDERATED_PROVIDERS: readonly FederatedProvider[] = ["google", "apple", "facebook"];

export const isFederatedProvider = (value: unknown): value is FederatedProvider =>
  FEDERATED_PROVIDERS.includes(value as FederatedProvider);

/** Who the provider says the person is. `issuer` + `subject` identify them for good; the address can change. */
export interface ExternalIdentity {
  /** The authority that vouches (`https://accounts.google.com`, `https://appleid.apple.com`…). */
  issuer: string;
  /** The person's stable id at that authority. */
  subject: string;
  email: string | null;
  /** The provider checked the address (a Facebook address, for one, may not be). */
  emailVerified: boolean;
  name: string | null;
}

/** What a sign-in is started with: a native app sends the PKCE challenge, a browser flow does not. */
export interface StartOptions {
  /** The S256 challenge of a PKCE flow (a native app); the matching verifier goes to `complete`. */
  codeChallenge?: string;
}

export interface StartedSignIn {
  /** Where to send the person: the provider's consent page, through krizaka-users. */
  url: string;
  /** Echoed back with the code: the product checks it against the one it kept for this browser. */
  state: string;
}

export interface CompleteOptions {
  /** The PKCE verifier of the challenge given to `start`. */
  codeVerifier?: string;
}

export interface IdentityProvider {
  /** Starts a sign-in with `provider`; the person comes back to `returnTo` (a path or an address the adapter allows) with a one-time code. */
  start(provider: FederatedProvider, returnTo: string, options?: StartOptions): Promise<StartedSignIn>;
  /** Exchanges the one-time code (single use) for the verified identity. Throws `FederationError("INVALID_CODE")` for a code that is unknown, used or expired. */
  complete(code: string, options?: CompleteOptions): Promise<ExternalIdentity>;
}

export const FEDERATION_CODE = {
  invalidCode: "INVALID_CODE",
  unknownProvider: "UNKNOWN_PROVIDER",
  badReturn: "BAD_RETURN_TO",
  unavailable: "UNAVAILABLE",
} as const;
export type FederationCode = (typeof FEDERATION_CODE)[keyof typeof FEDERATION_CODE];

export class FederationError extends Error {
  constructor(
    readonly code: FederationCode,
    message: string,
  ) {
    super(message);
    this.name = "FederationError";
  }
}

/** The S256 challenge of a PKCE verifier: base64url(SHA-256(verifier)). A native app computes it; the adapter and the in-memory provider check it. */
export const pkceChallenge = (verifier: string): string =>
  crypto.createHash("sha256").update(verifier).digest("base64url");

/** A return address stays on the product: a path (`/fr/account`), never `//host` or a scheme. */
export const isLocalReturn = (returnTo: string): boolean =>
  returnTo.startsWith("/") &&
  !returnTo.startsWith("//") &&
  !returnTo.includes("\\") &&
  [...returnTo].every((c) => c.charCodeAt(0) > 31);

/** An in-memory provider: the tests' adapter, and the reference the contract is written against. */
export function memoryIdentityProvider(): IdentityProvider & {
  /** Test seam: the one-time code the provider would hand back for this identity (with the PKCE challenge it was started with, if any). */
  issue(identity: ExternalIdentity, challenge?: string): string;
} {
  const pending = new Map<string, { identity: ExternalIdentity; challenge: string | null }>();
  let counter = 0;
  return {
    async start(provider, returnTo) {
      if (!isFederatedProvider(provider))
        throw new FederationError(FEDERATION_CODE.unknownProvider, `Unknown provider ${String(provider)}`);
      if (!isLocalReturn(returnTo))
        throw new FederationError(FEDERATION_CODE.badReturn, "That return address is not allowed");
      counter += 1;
      const state = `state-${counter}`;
      return { url: `https://auth.test/${provider}/start?state=${state}`, state };
    },
    async complete(code, options = {}) {
      const entry = pending.get(code);
      pending.delete(code); // single use, whatever happens next
      if (!entry) throw new FederationError(FEDERATION_CODE.invalidCode, "That code is not valid");
      if (
        entry.challenge !== null &&
        (!options.codeVerifier || pkceChallenge(options.codeVerifier) !== entry.challenge)
      )
        throw new FederationError(FEDERATION_CODE.invalidCode, "That code is not valid");
      return entry.identity;
    },
    issue(identity, challenge) {
      counter += 1;
      pending.set(`code-${counter}`, { identity, challenge: challenge ?? null });
      return `code-${counter}`;
    },
  };
}
