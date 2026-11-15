import { screen } from "@krizaka/docs";

import { CODE } from "@/lib/codes";
import { DocumentAction } from "@/lib/schemas";

export const manual = screen({
  order: 2,
  title: { en: "A document", fr: "Un document" },
  summary: { en: "The document, its report | and its file.", fr: "Le document, son rapport | et son fichier." },
  errors: [CODE.notFound],
  settings: ["storage.maxMegabytes"],
  actions: [
    {
      route: "POST /api/documents/[id]",
      title: { en: "Archive or delete", fr: "Archiver ou supprimer" },
      does: { en: "Archives the document, or deletes it.", fr: "Archive le document, ou le supprime." },
      input: DocumentAction,
      fields: {
        action: { en: "What to do.", fr: "Ce qu’il faut faire." },
        reason: { en: "Why it is deleted.", fr: "Pourquoi il est supprimé." },
      },
    },
    {
      route: "DELETE /api/documents/[id]",
      title: { en: "Delete the document", fr: "Supprimer le document" },
      does: { en: "Erases the file and gives a receipt.", fr: "Efface le fichier et remet un reçu." },
    },
  ],
});
