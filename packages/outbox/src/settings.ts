import { integer, type Registry } from "@krizaka/settings";

import type { OutboxSettings } from "./port";
import { OUTBOX_BOUNDS, OUTBOX_DEFAULTS } from "./rules";

const def = <K extends keyof OutboxSettings>(key: K, unit: string) => integer("outbox", OUTBOX_DEFAULTS[key], { min: OUTBOX_BOUNDS[key][0], max: OUTBOX_BOUNDS[key][1], unit });

/**
 * The settings of « outbox », a fragment the product adds to its registry (`@krizaka/outbox/settings`): the admin tunes the worker
 * without a redeploy. Global scope only.
 */
export const outboxSettings = {
  "outbox.batchSize": def("batchSize", "messages"),
  "outbox.leaseSeconds": def("leaseSeconds", "seconds"),
  "outbox.maxAttempts": def("maxAttempts", "attempts"),
  "outbox.backoffSeconds": def("backoffSeconds", "seconds"),
  "outbox.backoffMaxSeconds": def("backoffMaxSeconds", "seconds"),
  "outbox.retentionDays": def("retentionDays", "days"),
} as const satisfies Registry;

/**
 * The outbox's settings as `createOutbox` takes them, from the product's accessor (`(key) => service.get(key, ctx)`).
 * A key the accessor does not know falls back to the default.
 */
export async function readOutboxSettings(read: (key: keyof typeof outboxSettings) => number | undefined | Promise<number | undefined>): Promise<OutboxSettings> {
  const value = async (key: keyof OutboxSettings) => (await read(`outbox.${key}`)) ?? OUTBOX_DEFAULTS[key];
  return {
    batchSize: await value("batchSize"),
    leaseSeconds: await value("leaseSeconds"),
    maxAttempts: await value("maxAttempts"),
    backoffSeconds: await value("backoffSeconds"),
    backoffMaxSeconds: await value("backoffMaxSeconds"),
    retentionDays: await value("retentionDays"),
  };
}
