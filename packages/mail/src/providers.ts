import { MAIL_CODE, MailError, type MailProvider, type MailSettings, type OutgoingMail } from "./port";
import { bareAddress } from "./rules";

/** The part of `fetch` the providers use: inject the global one (`fetch`), or a fake in a test. */
export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Trims trailing slashes without a regular expression (a long run of slashes must not be quadratic). */
const withoutTrailingSlashes = (url: string) => {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
};

const failure = (provider: string, status: number, body: string) =>
  new MailError(MAIL_CODE.provider, `${provider} answered ${status}: ${body.slice(0, 200)}`);

const idOf = (body: string, key: string): string | null => {
  try {
    const value = (JSON.parse(body) as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
};

export interface MailgunOptions {
  apiKey: string;
  /** The sending domain. */
  domain: string;
  /** `https://api.mailgun.net` (default) or `https://api.eu.mailgun.net`. */
  apiUrl?: string;
  fetch: FetchLike;
}

/** Mailgun's messages API (form-encoded, basic auth). */
export function mailgunProvider(options: MailgunOptions): MailProvider {
  const base = withoutTrailingSlashes(options.apiUrl ?? "https://api.mailgun.net");
  const auth = `Basic ${Buffer.from(`api:${options.apiKey}`).toString("base64")}`;
  return {
    name: "mailgun",
    async send(mail) {
      const form = new URLSearchParams({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text });
      if (mail.html !== undefined) form.set("html", mail.html);
      if (mail.replyTo) form.set("h:Reply-To", mail.replyTo);
      form.set("v:idempotency-key", mail.idempotencyKey);
      const res = await options.fetch(`${base}/v3/${encodeURIComponent(options.domain)}/messages`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const body = await res.text();
      if (!res.ok) throw failure("mailgun", res.status, body);
      return { messageId: idOf(body, "id") };
    },
  };
}

export interface ResendOptions {
  apiKey: string;
  /** Default `https://api.resend.com`. */
  apiUrl?: string;
  fetch: FetchLike;
}

/** Resend's emails API (JSON, bearer key, its own `Idempotency-Key`). */
export function resendProvider(options: ResendOptions): MailProvider {
  const base = withoutTrailingSlashes(options.apiUrl ?? "https://api.resend.com");
  return {
    name: "resend",
    async send(mail) {
      const body = {
        from: mail.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.html === undefined ? {} : { html: mail.html }),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      };
      const res = await options.fetch(`${base}/emails`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": mail.idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const answer = await res.text();
      if (!res.ok) throw failure("resend", res.status, answer);
      return { messageId: idOf(answer, "id") };
    },
  };
}

/** The development provider: writes one JSON line per mail (without its body) and sends nothing. */
export function logProvider(write: (line: string) => void): MailProvider {
  return {
    name: "log",
    async send(mail) {
      write(
        JSON.stringify({
          event: "mail.log",
          from: bareAddress(mail.from),
          template: mail.template,
          category: mail.category,
          locale: mail.locale,
          subject: mail.subject,
          idempotencyKey: mail.idempotencyKey,
        }),
      );
      return { messageId: null };
    },
  };
}

/** The keys a provider needs: they stay in the environment, the product reads them and passes them here. */
export interface ProviderKeys {
  apiKey?: string;
  domain?: string;
  apiUrl?: string;
}

/**
 * The provider the admin chose (`mail.provider`). A provider chosen without its key is refused loudly, never replaced by `log`:
 * a reset mail must not vanish silently.
 * @throws MailError when the chosen provider lacks its key (or its domain, for Mailgun)
 */
export function providerFor(
  kind: MailSettings["provider"],
  keys: ProviderKeys,
  fetch: FetchLike,
  write: (line: string) => void,
): MailProvider {
  if (kind === "log") return logProvider(write);
  if (!keys.apiKey) throw new MailError(MAIL_CODE.badSettings, `mail.provider is ${kind} but its API key is not set`);
  if (kind === "resend")
    return resendProvider({ apiKey: keys.apiKey, fetch, ...(keys.apiUrl ? { apiUrl: keys.apiUrl } : {}) });
  if (!keys.domain) throw new MailError(MAIL_CODE.badSettings, "mail.provider is mailgun but its domain is not set");
  return mailgunProvider({
    apiKey: keys.apiKey,
    domain: keys.domain,
    fetch,
    ...(keys.apiUrl ? { apiUrl: keys.apiUrl } : {}),
  });
}

export type { OutgoingMail };
