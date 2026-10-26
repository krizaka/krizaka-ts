import { integer, type Registry } from "@krizaka/settings";

import { DEFAULT_TOLERANCE_SECONDS } from "./webhook";

/** The bounds of the webhook timestamp tolerance, in seconds. */
export const PAYMENTS_BOUNDS = { webhookToleranceSeconds: [30, 900] } as const;

/**
 * The settings of « payments », a fragment the product adds to its registry (`@krizaka/payments/settings`). Global scope only.
 * Prices are not here: they are the settings' price catalogue (ADR-009), and the processor holds the price objects built from it.
 */
export const paymentsSettings = {
  "payments.webhookToleranceSeconds": integer("payments", DEFAULT_TOLERANCE_SECONDS, { min: PAYMENTS_BOUNDS.webhookToleranceSeconds[0], max: PAYMENTS_BOUNDS.webhookToleranceSeconds[1], unit: "seconds" }),
} as const satisfies Registry;

/** The tolerance as `processorAdapter` takes it, from the product's accessor. A key the accessor does not know falls back to the default. */
export async function readPaymentsSettings(read: (key: keyof typeof paymentsSettings) => number | undefined | Promise<number | undefined>): Promise<{ webhookToleranceSeconds: number }> {
  return { webhookToleranceSeconds: (await read("payments.webhookToleranceSeconds")) ?? DEFAULT_TOLERANCE_SECONDS };
}
