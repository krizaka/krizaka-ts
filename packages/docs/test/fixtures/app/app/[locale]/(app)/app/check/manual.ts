import { screen } from "@krizaka/docs";

import { CODE } from "@/lib/codes";
import { UploadBody } from "@/lib/schemas";
import { SIGN_IN } from "@/lib/steps";

export const manual = screen({
  order: 1,
  title: { en: "Check a document", fr: "Vérifier un document" },
  summary: { en: "Drop a document and Verikora reads it.", fr: "Déposez un document et il est lu." },
  actions: [
    {
      route: "POST /api/documents",
      title: { en: "Upload a document", fr: "Envoyer un document" },
      does: { en: "Keeps the file and reads its text.", fr: "Garde le fichier et lit son texte." },
      input: UploadBody,
      fields: {
        kind: { en: "What the document is.", fr: "Ce qu’est le document." },
        note: { en: "A note for yourself.", fr: "Une note pour vous." },
      },
      errors: [CODE.tooLarge, CODE.extracting],
    },
  ],
  howTo: [
    {
      journey: "start-a-check",
      title: { en: "Check a lease", fr: "Vérifier un bail" },
      steps: [
        SIGN_IN,
        { en: "Drop the lease.", fr: "Déposez le bail." },
        { en: "Read the report.", fr: "Lisez le rapport." },
      ],
    },
  ],
});
