import type { LinkStore, ShareLink } from "./sharing-port";

/** The link store in memory: for tests and demos; the PostgreSQL adapter must pass the same behaviour. */
export function memoryLinkStore(): LinkStore {
  const links = new Map<string, ShareLink>();
  const own = (link: ShareLink | undefined, tenantId: string) => (link && link.tenantId === tenantId ? link : null);
  return {
    async insert(link) {
      links.set(link.id, link);
    },
    async byId(tenantId, id) {
      return own(links.get(id), tenantId);
    },
    async byTokenHash(tokenHash) {
      return [...links.values()].find((l) => l.tokenHash === tokenHash) ?? null;
    },
    async forDocument(tenantId, documentId) {
      return [...links.values()].filter((l) => l.tenantId === tenantId && l.documentId === documentId);
    },
    async countOpen(tenantId, id) {
      const link = own(links.get(id), tenantId);
      if (!link || (link.maxOpens !== null && link.opens >= link.maxOpens)) return false;
      links.set(id, { ...link, opens: link.opens + 1 });
      return true;
    },
    async revoke(tenantId, id, at) {
      const link = own(links.get(id), tenantId);
      if (link && link.revokedAt === null) links.set(id, { ...link, revokedAt: at });
    },
  };
}
