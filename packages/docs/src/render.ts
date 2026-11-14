import type { Manual, ManualActionPage, ManualEntry, ManualLocale, ManualPage, Text } from "./manual";
import { slugOf } from "./routes";

/** The words of the manual's own headings, by language. A product may pass its own. */
export interface ManualLabels {
  actions: string;
  fields: string;
  required: string;
  optional: string;
  oneOf: string;
  errors: string;
  settings: string;
  howTo: string;
  address: string;
}

export const MANUAL_LABELS: Readonly<Record<ManualLocale, ManualLabels>> = {
  en: {
    actions: "What you can do",
    fields: "What you give",
    required: "required",
    optional: "optional",
    oneOf: "one of",
    errors: "Messages you may see",
    settings: "Settings (administrator)",
    howTo: "How to",
    address: "Address",
  },
  fr: {
    actions: "Ce que vous pouvez faire",
    fields: "Ce que vous indiquez",
    required: "obligatoire",
    optional: "facultatif",
    oneOf: "au choix",
    errors: "Messages que vous pouvez voir",
    settings: "Réglages (administrateur)",
    howTo: "Comment faire",
    address: "Adresse",
  },
};

/** A page of the manual ready for `DocsArticlePage` + `Markdown` of @krizaka/ui. `generated` drives the « generated » chip. */
export interface ManualDocument {
  slug: string;
  route: string;
  locale: ManualLocale;
  title: string;
  description: string;
  generated: true;
  /** The body, without its title (the article page shows it). */
  markdown: string;
}

/** A table cell holds one line: a pipe would open a column. */
const cell = (s: string) =>
  s
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    .replaceAll("|", "\\|");

function entriesTable(entries: readonly ManualEntry[], locale: ManualLocale): string[] {
  return ["| | |", "| --- | --- |", ...entries.map((e) => `| \`${e.key}\` | ${cell(e.text[locale])} |`)];
}

function actionSection(action: ManualActionPage, locale: ManualLocale, labels: ManualLabels): string[] {
  const out = [`### ${action.title[locale]}`, "", action.does[locale], ""];
  if (action.fields.length > 0) {
    out.push(`**${labels.fields}**`, "");
    for (const f of action.fields) {
      const values = f.choices.map((c) => "`" + c + "`").join(", ");
      const choices = values === "" ? "" : ` (${labels.oneOf} ${values})`;
      out.push(`- **${f.name}** — ${f.required ? labels.required : labels.optional}: ${f.text[locale]}${choices}`);
    }
    out.push("");
  }
  if (action.errors.length > 0) out.push(`**${labels.errors}**`, "", ...entriesTable(action.errors, locale), "");
  return out;
}

/** The Markdown body of one page in one language. */
export function manualMarkdown(page: ManualPage, locale: ManualLocale, labels = MANUAL_LABELS[locale]): string {
  const out = [page.summary[locale], "", `${labels.address}: \`${page.route}\``, ""];
  for (const how of page.howTo) {
    out.push(`## ${labels.howTo} — ${how.title[locale]}`, "");
    how.steps.forEach((step: Text, i) => out.push(`${i + 1}. ${step[locale]}`));
    out.push("");
    for (const media of how.media) out.push(`![${cell(how.title[locale])}](${media})`, "");
  }
  if (page.actions.length > 0) {
    out.push(`## ${labels.actions}`, "");
    for (const action of page.actions) out.push(...actionSection(action, locale, labels));
  }
  if (page.errors.length > 0) out.push(`## ${labels.errors}`, "", ...entriesTable(page.errors, locale), "");
  if (page.settings.length > 0) out.push(`## ${labels.settings}`, "", ...entriesTable(page.settings, locale), "");
  return `${out.join("\n").trimEnd()}\n`;
}

/** Every page of the manual in one language, in the manual's order. */
export function manualDocuments(
  manual: Manual,
  locale: ManualLocale,
  labels = MANUAL_LABELS[locale],
): ManualDocument[] {
  return manual.pages.map((page) => ({
    slug: slugOf(page.route),
    route: page.route,
    locale,
    title: page.title[locale],
    description: page.summary[locale],
    generated: true,
    markdown: manualMarkdown(page, locale, labels),
  }));
}
