/**
 * What a product writes next to a screen so its user manual is built from the code (krizaka-internal#3644). A `manual.ts` beside
 * the screen's `page.tsx` exports `manual = screen({ … })`; the extractor (`@krizaka/docs/extract`) reads it from the TypeScript
 * program, checks it against the routes, the schemas, the catalogues and the journeys, and a gap fails the build.
 *
 * Everything in a manual block is a literal the compiler can read: strings, arrays, objects, and constants whose type is a string
 * literal (`CODE.tooLarge` of an `as const` catalogue). A computed value is refused by the extractor, never guessed.
 */

/** The languages a Krizaka product speaks. */
export type ManualLocale = "en" | "fr";

/** One sentence in every language of the product: `{ en: "Drop a document.", fr: "Déposez un document." }`. */
export type Text<L extends string = ManualLocale> = Readonly<Record<L, string>>;

/** The HTTP methods a route handler exports. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Something the user does on a screen, through one route handler. */
export interface ManualAction<L extends string = ManualLocale> {
  /** The route handler the action calls, method and path as the app router writes it: `"POST /api/documents/[id]"`. */
  route: `${HttpMethod} /${string}`;
  title: Text<L>;
  /** What happens, in the user's words. */
  does: Text<L>;
  /**
   * The schema of what the user sends (any Standard Schema: zod, valibot…). Its input fields are listed in the manual and each one
   * must be described in `fields`; a description of a field the schema no longer has fails too.
   */
  input?: unknown;
  /** One line per field the user fills, by field name. */
  fields?: Readonly<Record<string, Text<L>>>;
  /** The error codes the action can answer, each a key of the product's error catalogue. */
  errors?: readonly string[];
}

/** A « how to » built on an e2e journey: the steps a person follows, as many as the journey proves. */
export interface ManualHowTo<L extends string = ManualLocale> {
  /** The id of the journey in the product's journey manifest (`e2e/journeys/journeys.json`). */
  journey: string;
  title: Text<L>;
  /** One entry per step of the journey, in the reader's words; the count must equal the journey's. */
  steps: readonly Text<L>[];
}

/** The manual block of one screen. */
export interface ManualScreen<L extends string = ManualLocale> {
  title: Text<L>;
  /** What the screen is for, in one or two sentences. */
  summary: Text<L>;
  /** The position in the manual's navigation (ascending; then by route). */
  order?: number;
  actions?: readonly ManualAction<L>[];
  /** The settings an administrator changes for this screen, each a key of the product's settings catalogue. */
  settings?: readonly string[];
  /** Errors the screen shows on its own (not through an action), each a key of the error catalogue. */
  errors?: readonly string[];
  howTo?: readonly ManualHowTo<L>[];
}

/** Declares a screen's manual block; the identity, typed, so the compiler checks the block before the extractor does. */
export const screen = <const S extends ManualScreen>(block: S): S => block;

/** A field of an action's input, as the schema declares it. */
export interface ManualField<L extends string = ManualLocale> {
  name: string;
  required: boolean;
  /** The values a closed field accepts (a union of string literals); empty otherwise. */
  choices: readonly string[];
  text: Text<L>;
}

/** An entry of a catalogue (an error code, a setting key) with its text in every language. */
export interface ManualEntry<L extends string = ManualLocale> {
  key: string;
  text: Text<L>;
}

/** An action as the manual shows it, checked against its route handler. */
export interface ManualActionPage<L extends string = ManualLocale> {
  method: HttpMethod;
  path: string;
  title: Text<L>;
  does: Text<L>;
  fields: readonly ManualField<L>[];
  errors: readonly ManualEntry<L>[];
}

/** A « how to » as the manual shows it, with the recordings of its journey when there are some. */
export interface ManualHowToPage<L extends string = ManualLocale> {
  journey: string;
  title: Text<L>;
  steps: readonly Text<L>[];
  /** Paths of the journey's recorded screenshots and videos, as the product passed them. */
  media: readonly string[];
}

/** One page of the manual: one screen. */
export interface ManualPage<L extends string = ManualLocale> {
  /** The screen's address without its language: `/app/check`, `/app/documents/[id]`. */
  route: string;
  /** The manual block's file, relative to the screens' folder. */
  source: string;
  order: number;
  title: Text<L>;
  summary: Text<L>;
  actions: readonly ManualActionPage<L>[];
  settings: readonly ManualEntry<L>[];
  errors: readonly ManualEntry<L>[];
  howTo: readonly ManualHowToPage<L>[];
}

/** The whole manual of a product. */
export interface Manual<L extends string = ManualLocale> {
  pages: readonly ManualPage<L>[];
  /** Screens not documented yet (the product's `pending` list, which only goes down). */
  pending: readonly string[];
}

/** One gap the extractor found: the build fails on any. */
export interface ManualProblem {
  /** The file at fault, relative to the screens' or the app's folder. */
  file: string;
  message: string;
}

export const MANUAL_CODE = { incomplete: "MANUAL_INCOMPLETE" } as const;

/** The manual cannot be built: a screen, a field, an error or a journey has no source, or a source points at nothing. */
export class ManualError extends Error {
  readonly code = MANUAL_CODE.incomplete;
  constructor(readonly problems: readonly ManualProblem[]) {
    super(
      `The user manual cannot be built (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
        problems.map((p) => `  - ${p.file}: ${p.message}`).join("\n"),
    );
    this.name = "ManualError";
  }
}
