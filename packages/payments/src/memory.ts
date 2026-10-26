import type { DiscountStore, EventStore } from "./port";

/** An in-memory record of applied notifications, for unit tests (same behaviour as the database's). */
export function memoryEventStore(): Required<EventStore> & { ids(): string[] } {
  const seen = new Map<string, string>();
  return {
    ids: () => [...seen.keys()],
    async markSeen(id, type) {
      if (seen.has(id)) return false;
      seen.set(id, type);
      return true;
    },
    async forget(id) {
      seen.delete(id);
    },
  };
}

/** An in-memory memory of the processor's discount objects, for unit tests. */
export function memoryDiscountStore(): DiscountStore {
  const refs = new Map<string, string>();
  const key = (couponId: string, version: number, provider: string) => `${provider}:${couponId}:${version}`;
  return {
    async find(couponId, termsVersion, provider) {
      return refs.get(key(couponId, termsVersion, provider)) ?? null;
    },
    async remember(couponId, termsVersion, provider, providerRef) {
      const k = key(couponId, termsVersion, provider);
      if (!refs.has(k)) refs.set(k, providerRef);
      return refs.get(k)!;
    },
  };
}
