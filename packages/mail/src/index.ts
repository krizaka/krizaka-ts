export { emailPorts } from "./email-ports";
export { createMail, type Mail, MAIL_EVENT, MAIL_TOPIC, type MailDeps, type MailOutbox, type QueuedMail } from "./mail";
export { memoryMailStore } from "./memory";
export { dbMailStore } from "./persistence";
export * from "./port";
export { type FetchLike, logProvider, type MailgunOptions, mailgunProvider, providerFor, type ProviderKeys, type ResendOptions, resendProvider } from "./providers";
export { bareAddress, checkAddress, checkMessage, checkSettings, hashAddress, MAIL_BOUNDS, MAIL_DEFAULTS, normalizeAddress, uuidOf } from "./rules";
export { mailSchema } from "./schema";
export { parseMailgunWebhook, parseResendWebhook, type Suppression, type SvixHeaders } from "./webhooks";
