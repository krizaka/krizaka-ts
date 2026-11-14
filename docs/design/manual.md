# Design — each asset's user manual, generated at build from the code

Issue: krizaka-internal#3644 · module: krizaka-internal#763 (`@krizaka/docs`) · package: [`packages/docs`](../../packages/docs#readme)

The founder (2026-11-14): the user manual of each asset is generated at build, « as code », so nobody has to update it by hand and
it is right at every build. This note says where the text lives, how it is read, what a page holds, how a gap fails the build and
how the pages render.

## 1. Where the functional text lives: a `manual.ts` beside each screen

A screen of the app router is a folder with a `page.tsx`. Its manual block is the **`manual.ts` in the same folder**:

```ts
// app/[locale]/(app)/app/check/manual.ts
import { screen } from "@krizaka/docs";
import { CODE } from "@/lib/errors";
import { UploadBody } from "@/lib/api/documents";

export const manual = screen({
  order: 1,
  title: { en: "Check a document", fr: "Vérifier un document" },
  summary: { en: "…", fr: "…" },
  actions: [
    {
      route: "POST /api/documents", // the route handler it calls
      title: { en: "…", fr: "…" },
      does: { en: "…", fr: "…" },
      input: UploadBody, // the zod (Standard Schema) of what the user sends
      fields: { kind: { en: "…", fr: "…" } }, // one line per input field
      errors: [CODE.tooLarge, CODE.extracting],
    },
  ],
  howTo: [{ journey: "start-a-check", title: { en: "…", fr: "…" }, steps: [/* one per journey step */] }],
});
```

Why a typed block and not TSDoc, and why beside the page and not in it:

- **Two languages.** Every product speaks French and English; a TSDoc comment holds one text. A `{ en, fr }` object is typed
  (`Text`), so a missing language is a compile error before it is an extractor error.
- **Next.js refuses unknown exports** from `page.tsx` and `route.ts` (only `default`, `metadata`, `GET`, `POST`… are allowed), so
  the block cannot sit in those files. Any other file in a route folder is colocated and never routed: `manual.ts` is next to the
  code it describes, in the same review, without touching the page's bundle (the page never imports it).
- **References, not copies.** What the code already knows is referenced, not retyped: the route (`"POST /api/documents"`), the
  input schema (`UploadBody`), the error codes (the typed catalogue's constants), the journey (its id). Only the reader's words are
  written, once.

## 2. How the extractor reads it: the TypeScript program

`@krizaka/docs/extract` takes the product's program (`programOf("apps/web/tsconfig.json")`, the product's own compiler) and never
reads a source file as text:

- **Screens** are the program's `page.{tsx,ts}` files under the screens' folder; the address comes from the folder, route groups
  `(…)` and slots `@…` left out, `[id]` kept. **Route handlers** are the `route.ts` files under the app folder, with the methods
  their module exports (`checker.getExportsOfModule`).
- **The block** is the module's `manual` export, read by a static evaluator over the AST: literals, arrays, objects, `const` names
  (a shared step), and any expression whose type the checker knows to be one literal (`CODE.tooLarge` of an `as const` catalogue,
  a template of constants). Anything that needs the code to run (`"x".toUpperCase()`, a spread, a function) is refused with its
  line, never guessed.
- **Input fields** come from the schema's type: `input`'s `~standard.types.input` (Standard Schema: zod 4, valibot, arktype), so
  each property gives its name, whether it is required, and its choices when it is a union of string literals (`z.enum`).
- **Catalogues** are passed in as data by the product: its error messages (`messages/{en,fr}.json` › `console.errors`) and its
  settings' labels. **Journeys** are the product's e2e manifest (`e2e/journeys/journeys.json`) with the paths of their recordings.

The package is generic: it knows the app router's file convention and Standard Schema, nothing of a product.

## 3. What a page contains

One page per screen, in each language (`ManualPage` → `manualDocuments(manual, locale)`):

- the screen's title, its summary and its address;
- **How to**: one section per journey the screen anchors, its steps in the reader's words, as many as the journey proves, and the
  journey's recorded screenshots and videos when the product passes them;
- **What you can do**: each action, what it does, the fields the user gives (required or optional, the choices of a closed field)
  and the messages it can answer, in the catalogue's own words;
- **Messages you may see** on the screen itself, from the error catalogue;
- **Settings (administrator)**: the settings keys the screen depends on, with their catalogue text.

## 4. How a missing source fails the build

`buildManual` throws one `ManualError` (`MANUAL_INCOMPLETE`) listing every gap, so the product's build step fails:

| Gap                                                              | Message                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| a screen without its `manual.ts`, not in `pending`               | `the screen /app/x has no manual.ts beside its page`              |
| a text without one of the languages                              | `title has no fr text`                                            |
| an input field nobody described                                  | `the field « note » has no text`                                  |
| a description of a field the schema dropped                      | `fields.comment describes a field the input schema does not have` |
| an action whose route moved, or a method not exported            | `no route handler answers /api/files` · `exports no PUT`          |
| an error code or setting without words in a language             | `error FILE_TOO_LARGE has no fr text in the error catalogue`      |
| a « how to » on an unknown journey, or a step count that drifted | `the journey « start-a-check » has 4 steps, the manual 3`         |
| a value that needs the code to run                               | `line 10: « … » cannot be read at build: write a literal`         |
| a block beside no page; a pending screen documented or gone      | `a manual block beside no page` · `remove it from pending`        |

`pending` is the adoption list: the screens not documented yet, recorded once, and it only goes down (the same rule as the known
violations of dependency-cruiser). A new screen never goes into it.

## 5. How pages render: @krizaka/ui's docs components

The package draws nothing (ADR-004: krizaka-ts never imports what renders). It hands each page as `{ slug, title, description,
generated: true, markdown }`; the product renders it the same way everywhere:

- `DocsHubPage` lists the manual's pages; `DocsNav` gives the sidebar (one group « Manual », the pages in `order`);
- `DocsArticlePage` frames a page: `title`, `lead` = the description, `toc` from the `##` headings;
- `Markdown` renders the body, with the « generated » chip from `generated` (#763: never a sentence in the text).

A product generates the manual in its build (`prebuild`: `buildManual` → `lib/generated/manual.json`) and has a test that runs the
extractor on its own program (a missing source fails `pnpm test` too, before the build).

## 6. Why `@krizaka/docs` in krizaka-ts

- The org's rule for shared TypeScript that does not render is a `@krizaka/*` package in krizaka-ts; #763 already names
  `@krizaka/docs` there as the generate-and-publish toolkit of every product, and the manual is its first part.
- It reads programs and writes data, never draws: krizaka-ui renders it (§ 5).
- Generic: no product import, no environment, no file written by the package. `typescript` is a peer dependency, so the product's
  own compiler reads its own program.
- The authoring entry (`@krizaka/docs`: `screen`, the types, the renderer) has no dependency; only `@krizaka/docs/extract` needs
  `typescript`, and it runs only at build.

## 7. Adoption

Verikora is the pilot (its main journeys first: upload, « which document? », the report, the deletion receipt); then Folioviv,
Sovkora, Kridoc and the library sites, one ticket each under #763. Each product's local doc generators are deleted as it adopts
the module.
