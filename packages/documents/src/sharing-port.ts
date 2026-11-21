import type { Clock } from "./port";

/** What a link opens: view only, or view and download. */
export type LinkAccess = "view" | "download";

/** A share link. Only the hash of its token is stored; the token is shown once, to the person who creates it. */
export interface ShareLink {
  id: string;
  tenantId: string;
  documentId: string;
  tokenHash: string;
  access: LinkAccess;
  expiresAt: Date;
  maxOpens: number | null;
  opens: number;
  revokedAt: Date | null;
  createdAt: Date;
}

/** The link store of one deployment, scoped by tenant. */
export interface LinkStore {
  insert(link: ShareLink): Promise<void>;
  byId(tenantId: string, id: string): Promise<ShareLink | null>;
  byTokenHash(tokenHash: string): Promise<ShareLink | null>;
  forDocument(tenantId: string, documentId: string): Promise<ShareLink[]>;
  /** Counts one open only if the link still has one left: true when counted (atomic in a real store). */
  countOpen(tenantId: string, id: string): Promise<boolean>;
  revoke(tenantId: string, id: string, at: Date): Promise<void>;
}

export type { Clock };
