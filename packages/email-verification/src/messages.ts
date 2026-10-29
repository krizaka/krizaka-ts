/** The mail that carries the code, in the visitor's language. Plain text first; the HTML twin is the same words. */
export type VerificationLocale = "en" | "fr";

export interface VerificationMail {
  subject: string;
  text: string;
  html: string;
}

const TEXTS = {
  en: {
    subject: (code: string) => `Your Krizaka code: ${code}`,
    intro: "Here is your verification code:",
    outro: (minutes: number) => `It is valid for ${minutes} minutes and works once. Enter it on the page to send your message.`,
    ignore: "If you did not ask for it, ignore this e-mail: nothing was sent.",
  },
  fr: {
    subject: (code: string) => `Votre code Krizaka : ${code}`,
    intro: "Voici votre code de vérification :",
    outro: (minutes: number) => `Il est valable ${minutes} minutes et ne sert qu'une fois. Saisissez-le sur la page pour envoyer votre message.`,
    ignore: "Si vous ne l'avez pas demandé, ignorez ce courriel : rien n'a été envoyé.",
  },
} as const;

/** Subject, text and HTML of the code mail. `code` is digits only (it comes from `issue`). */
export function verificationMail(input: { locale: string; code: string; ttlMinutes: number }): VerificationMail {
  const t = input.locale === "fr" ? TEXTS.fr : TEXTS.en;
  const digits = input.code.replaceAll(/\D/g, "");
  const text = `${t.intro}\n\n${digits}\n\n${t.outro(input.ttlMinutes)}\n${t.ignore}\n`;
  const html = `<p>${t.intro}</p><p style="font-size:28px;letter-spacing:6px;font-family:monospace"><strong>${digits}</strong></p><p>${t.outro(input.ttlMinutes)}</p><p>${t.ignore}</p>`;
  return { subject: t.subject(digits), text, html };
}
