import { screen } from "@krizaka/docs";

import { CODE } from "@/lib/codes";

export const manual = screen({
  order: 2,
  title: { en: "A document", fr: "Un document" },
  summary: { en: "The document, its report | and its file.", fr: "Le document, son rapport | et son fichier." },
  errors: [CODE.notFound],
  settings: ["storage.maxMegabytes"],
  actions: [
    {
      route: "DELETE /api/documents/[id]",
      title: { en: "Delete the document", fr: "Supprimer le document" },
      does: { en: "Erases the file and gives a receipt.", fr: "Efface le fichier et remet un reçu." },
    },
  ],
});
