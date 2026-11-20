import { addDays, isAfter } from "date-fns";

import type { Documents } from "./documents";
import { DOCUMENT_CODE, DocumentError } from "./errors";
import type { Clock } from "./port";
import type { LinkAccess, LinkStore, ShareLink } from "./sharing-port";

/** The bounds the product reads from @krizaka/settings. */
export interface SharingLimits {
  defaultExpiryDays: number;
  maxExpiryDays: number;
  maxOpensCeiling: number;
}

export interface SharingDeps {
  links: LinkStore;
  documents: Documents;
  clock: Clock;
  limits: SharingLimits;
  newId: () => string;
  /** A new unguessable token (the BFF's random source). */
  newToken: () => string;
  /** A one-way hash of a token (SHA-256 in the BFF). */
  hashToken: (token: string) => string;
}

/**
 * Expiring, revocable share links to a document: they always expire, may cap their opens, and say view or download.
 * @param deps the stores, the clock, the limits and the token functions
 * @returns the functions, each scoped by tenant
 */
export function createSharing(deps: SharingDeps) {
  const { links, documents, clock, limits, newId, newToken, hashToken } = deps;
  const refuse = (why: string) => new DocumentError(DOCUMENT_CODE.LinkRefused, why);
  return {
    /** Creates a link; returns it with the token, which is never stored and never shown again. */
    async createLink(
      tenantId: string,
      input: { documentId: string; access: LinkAccess; expiresInDays?: number; maxOpens?: number },
    ): Promise<{ link: ShareLink; token: string }> {
      const days = input.expiresInDays ?? limits.defaultExpiryDays;
      if (!Number.isInteger(days) || days < 1 || days > limits.maxExpiryDays)
        throw new DocumentError(DOCUMENT_CODE.InvalidLink, `a link lives 1 to ${limits.maxExpiryDays} days`);
      const maxOpens = input.maxOpens ?? null;
      if (maxOpens !== null && (!Number.isSafeInteger(maxOpens) || maxOpens < 1 || maxOpens > limits.maxOpensCeiling))
        throw new DocumentError(DOCUMENT_CODE.InvalidLink, `a link opens 1 to ${limits.maxOpensCeiling} times`);
      await documents.getDocument(tenantId, input.documentId);
      const now = clock.now();
      const token = newToken();
      const link: ShareLink = {
        id: newId(),
        tenantId,
        documentId: input.documentId,
        tokenHash: hashToken(token),
        access: input.access,
        expiresAt: addDays(now, days),
        maxOpens,
        opens: 0,
        revokedAt: null,
        createdAt: now,
      };
      await links.insert(link);
      return { link, token };
    },
    listLinks: (tenantId: string, documentId: string) => links.forDocument(tenantId, documentId),
    /** Revokes at once; a revoked link is refused from then on. */
    async revokeLink(tenantId: string, id: string): Promise<void> {
      if (!(await links.byId(tenantId, id))) throw new DocumentError(DOCUMENT_CODE.LinkRefused, "link not found");
      await links.revoke(tenantId, id, clock.now());
    },
    /** Opens a link by its token: counts the open and returns what the BFF may stream. Every refusal is the same error. */
    async openLink(token: string): Promise<{ tenantId: string; documentId: string; access: LinkAccess }> {
      const link = await links.byTokenHash(hashToken(token));
      if (!link || link.revokedAt !== null || !isAfter(link.expiresAt, clock.now())) throw refuse("link refused");
      if (!(await links.countOpen(link.tenantId, link.id))) throw refuse("link refused");
      return { tenantId: link.tenantId, documentId: link.documentId, access: link.access };
    },
  };
}

export type Sharing = ReturnType<typeof createSharing>;
