# @krizaka/docs

The documentation module of every Krizaka product (krizaka-internal#763). Its first part: **the user manual, generated at build
from the code**. The design: [docs/design/manual.md](../../docs/design/manual.md).

- The functional text lives next to the screen: a `manual.ts` beside each `page.tsx`, `export const manual = screen({ … })`, in
  French and English, referencing what the code already holds (the route handler, the input schema, the error codes, the journey).
- The extractor reads the product's **TypeScript program** (never the source as text) and checks every block against the code.
- A screen without its text, a stale route, an undescribed field, an unknown error code or a journey whose steps drifted **fails
  the build**: a stale page cannot be published.
- It draws nothing: the pages are Markdown for `DocsArticlePage` and `Markdown` of `@krizaka/ui`.

```ts
// app/[locale]/(app)/app/check/manual.ts — next to the page
import { screen } from "@krizaka/docs";

export const manual = screen({
  title: { en: "Check a document", fr: "Vérifier un document" },
  summary: {
    en: "Drop a document; Verikora reads it and checks it.",
    fr: "Déposez un document ; Verikora le lit et le vérifie.",
  },
  actions: [
    {
      route: "POST /api/documents",
      title: { en: "Upload a document", fr: "Envoyer un document" },
      does: { en: "…", fr: "…" },
      input: UploadBody, // zod or any Standard Schema: each input field must be described
      fields: { kind: { en: "What the document is.", fr: "Ce qu’est le document." } },
      errors: [CODE.tooLarge],
    },
  ],
  howTo: [{ journey: "start-a-check", title: { en: "…", fr: "…" }, steps: [/* one per step of the journey */] }],
});
```

```ts
// scripts/gen-manual.mjs — at build
import { buildManual, programOf } from "@krizaka/docs/extract";
import { manualDocuments } from "@krizaka/docs";

const manual = buildManual({
  program: programOf("tsconfig.json"),
  app: path.resolve("app"),
  screens: path.resolve("app/[locale]/(app)"),
  errors: { en: en.console.errors, fr: fr.console.errors },
  journeys, // e2e/journeys/journeys.json, with the paths of their recordings
  pending: [], // screens not documented yet: only goes down
}); // throws ManualError (MANUAL_INCOMPLETE) with every gap
writeFileSync(
  "lib/generated/manual.json",
  JSON.stringify({ en: manualDocuments(manual, "en"), fr: manualDocuments(manual, "fr") }),
);
```

- `@krizaka/docs`: `screen`, the types of a block and of a page, `ManualError`, `manualDocuments` / `manualMarkdown`, `slugOf`. No dependency.
- `@krizaka/docs/extract`: `buildManual`, `readManual` (the manual and its problems), `programOf`. Needs `typescript` (peer).
