import type { Clock, DeliveryEntry, MailStore, SuppressionReason } from "./port";
import { hashAddress } from "./rules";

/**
 * The three ports of `@krizaka/email` (`DeliveryLog`, `SuppressionList`, `IdempotencyStore`) over this module's store, so a product
 * that calls `sendEmail` directly writes to the same tables as the queue. Structural: this package never imports `@krizaka/email`.
 */
export function emailPorts(store: MailStore, clock: Clock) {
  return {
    log: { record: (entry: Omit<DeliveryEntry, "at"> & { at?: string }) => store.record({ ...entry, at: entry.at ? new Date(entry.at) : clock.now() }) },
    suppression: {
      has: (email: string) => store.isSuppressed(hashAddress(email)),
      add: async (email: string, reason: SuppressionReason): Promise<void> => {
        await store.suppress(hashAddress(email), reason, clock.now());
      },
    },
    idempotency: {
      claim: (key: string) => store.claimKey(key, clock.now()),
      release: (key: string) => store.releaseKey(key),
    },
  };
}

