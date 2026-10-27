import { choice, integer, type Registry, text } from "@krizaka/settings";

import type { MailSettings } from "./port";
import { MAIL_BOUNDS, MAIL_DEFAULTS } from "./rules";

const PROVIDERS = ["log", "mailgun", "resend"] as const;

/**
 * The settings of « mail », a fragment the product adds to its registry (`@krizaka/mail/settings`): the admin picks the provider and
 * the sender without a redeploy. Secrets (the provider's key, domain and webhook signing keys) stay in the environment.
 */
export const mailSettings = {
  "mail.provider": choice("mail", PROVIDERS, MAIL_DEFAULTS.provider),
  "mail.from": text("mail", MAIL_DEFAULTS.from),
  "mail.replyTo": text("mail", MAIL_DEFAULTS.replyTo, { empty: true }),
  "mail.retentionDays": integer("mail", MAIL_DEFAULTS.retentionDays, { min: MAIL_BOUNDS.retentionDays[0], max: MAIL_BOUNDS.retentionDays[1], unit: "days" }),
} as const satisfies Registry;

type Reader = (key: keyof typeof mailSettings) => string | number | undefined | Promise<string | number | undefined>;

/** The module's settings as `createMail` takes them, from the product's accessor (`(key) => service.get(key, ctx)`). A key the accessor does not know falls back to the default. */
export async function readMailSettings(read: Reader): Promise<MailSettings> {
  const provider = await read("mail.provider");
  const from = await read("mail.from");
  const replyTo = await read("mail.replyTo");
  const retention = await read("mail.retentionDays");
  return {
    provider: PROVIDERS.find((p) => p === provider) ?? MAIL_DEFAULTS.provider,
    from: typeof from === "string" && from !== "" ? from : MAIL_DEFAULTS.from,
    replyTo: typeof replyTo === "string" ? replyTo : MAIL_DEFAULTS.replyTo,
    retentionDays: typeof retention === "number" ? retention : MAIL_DEFAULTS.retentionDays,
  };
}
