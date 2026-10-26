import { integer, type Registry } from "@krizaka/settings";

import { PASSWORD_RESET_MAX_MINUTES, PASSWORD_RESET_MIN_MINUTES, PASSWORD_RESET_TTL_MINUTES } from "./accounts";

/**
 * The settings of « auth », a fragment the product adds to its registry (`@krizaka/auth/settings`): how long a session and a reset link
 * live. The admin changes them without a redeploy; the product reads them and passes them to `createSessions({ sessionDays })` and
 * `dbAccounts({ passwordResetTtlMinutes })`. Global scope only.
 */
export const authSettings = {
  // @fixed: two weeks by default, as the products' copies had; the admin chooses between one day and ninety.
  "auth.sessionDays": integer("auth", 14, { min: 1, max: 90, unit: "days" }),
  "auth.passwordResetMinutes": integer("auth", PASSWORD_RESET_TTL_MINUTES, { min: PASSWORD_RESET_MIN_MINUTES, max: PASSWORD_RESET_MAX_MINUTES, unit: "minutes" }),
} as const satisfies Registry;
