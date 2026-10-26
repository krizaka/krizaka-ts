import type { ExternalIdentity } from "./federation";
import type { IdentityLinkStore } from "./identity-links";

/** What federated sign-in needs from the product's accounts: no second user table, just a look-up and, when registration is open, a creation. */
export interface FederatedAccounts {
  /** The account that holds this address (lower case), and whether the product has verified it; null when none. */
  findByEmail(email: string): Promise<{ id: string; emailVerified: boolean } | null>;
  /** Creates an account for a person the provider vouches for (address verified, no password). Absent when registration is closed. */
  create?(identity: ExternalIdentity & { email: string }): Promise<string>;
}

/** Why a sign-in was refused: a stable code the product maps to its words. */
export const FEDERATED_REFUSAL = {
  /** The provider did not verify the address (or gave none): nothing is linked, nothing is created. */
  emailNotVerified: "EMAIL_NOT_VERIFIED",
  /** An account holds the address but the product never verified it: linking would let a stranger take it over. */
  accountEmailUnverified: "ACCOUNT_EMAIL_UNVERIFIED",
  /** No account, and registration is closed. */
  noAccount: "NO_ACCOUNT",
} as const;
export type FederatedRefusal = (typeof FEDERATED_REFUSAL)[keyof typeof FEDERATED_REFUSAL];

export type FederatedSignInResult =
  /** `via`: `link` already linked, `linked` attached to the account of that address now, `created` a new account. */
  | { status: "signed-in"; accountId: string; via: "link" | "linked" | "created" }
  | { status: "refused"; code: FederatedRefusal };

export interface FederatedSignInDeps {
  links: IdentityLinkStore;
  accounts: FederatedAccounts;
  clock: { now(): Date };
}

/**
 * From a verified external identity to an account of the product. The rule that matters: an identity attaches to an EXISTING account
 * only when the address is verified on both sides — by the provider and by the product. Otherwise a stranger who registers at
 * Facebook with your address would sign in as you.
 */
export function createFederatedSignIn({ links, accounts, clock }: FederatedSignInDeps) {
  return {
    async signIn(identity: ExternalIdentity): Promise<FederatedSignInResult> {
      const known = await links.find(identity.issuer, identity.subject);
      if (known) return { status: "signed-in", accountId: known, via: "link" };

      const email = identity.email?.trim().toLowerCase();
      if (!email || !identity.emailVerified) return { status: "refused", code: FEDERATED_REFUSAL.emailNotVerified };

      const existing = await accounts.findByEmail(email);
      if (existing) {
        if (!existing.emailVerified) return { status: "refused", code: FEDERATED_REFUSAL.accountEmailUnverified };
        await links.link(existing.id, identity.issuer, identity.subject, clock.now());
        return { status: "signed-in", accountId: existing.id, via: "linked" };
      }

      if (!accounts.create) return { status: "refused", code: FEDERATED_REFUSAL.noAccount };
      const accountId = await accounts.create({ ...identity, email });
      await links.link(accountId, identity.issuer, identity.subject, clock.now());
      return { status: "signed-in", accountId, via: "created" };
    },
  };
}

export type FederatedSignIn = ReturnType<typeof createFederatedSignIn>;
