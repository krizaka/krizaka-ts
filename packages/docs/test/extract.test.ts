import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { buildManual, programOf, readManual } from "../src/extract";
import { MANUAL_CODE, ManualError } from "../src/manual";
import { CHECK, FIXTURE, fixtureProgram, fixtureSources, SCREENS } from "./fixture";

const checkBlock = readFileSync(CHECK, "utf8");

/** The problems of the fixture with one file changed. */
function problemsWith(changes: Record<string, string | null>, overrides = {}) {
  return readManual(fixtureSources({ program: fixtureProgram(changes), ...overrides })).problems.map(
    (p) => `${p.file}: ${p.message}`,
  );
}

describe("buildManual on a complete app", () => {
  const manual = buildManual(fixtureSources({ program: programOf(path.join(FIXTURE, "tsconfig.json")) }));

  it("the fixture's blocks type-check against `screen`, so the compiler refuses a malformed block before the extractor runs", () => {
    const program = fixtureProgram();
    expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual(
      [],
    );
  });

  it("builds one page per documented screen, in the blocks' order, and keeps the pending list", () => {
    expect(manual.pages.map((p) => p.route)).toEqual(["/app/check", "/app/documents/[id]"]);
    expect(manual.pages[0]?.source).toBe(path.join("app", "check", "manual.ts"));
    expect(manual.pending).toEqual(["/app/settings"]);
  });

  it("lists an action's fields from its schema's input type, with what is required and the closed choices", () => {
    const upload = manual.pages[0]?.actions[0];
    expect(upload).toMatchObject({ method: "POST", path: "/api/documents" });
    expect(upload?.fields).toEqual([
      {
        name: "kind",
        required: true,
        choices: ["lease", "invoice"],
        text: { en: "What the document is.", fr: "Ce qu’est le document." },
      },
      { name: "note", required: false, choices: [], text: { en: "A note for yourself.", fr: "Une note pour vous." } },
    ]);
  });

  it("reads error codes through the typed catalogue's constants and takes their words from the product's messages", () => {
    expect(manual.pages[0]?.actions[0]?.errors.map((e) => e.key)).toEqual(["FILE_TOO_LARGE", "EXTRACTING"]);
    expect(manual.pages[1]?.errors).toEqual([{ key: "NOT_FOUND", text: { en: "Not found.", fr: "Introuvable." } }]);
    expect(manual.pages[1]?.settings[0]?.key).toBe("storage.maxMegabytes");
  });

  it("builds the « how to » on the journey, a shared step read through its constant, with the journey's recordings", () => {
    expect(manual.pages[0]?.howTo[0]).toMatchObject({
      journey: "start-a-check",
      steps: [{ en: "Sign in.", fr: "Connectez-vous." }, { en: "Drop the lease." }, { en: "Read the report." }],
      media: ["/journeys/start-a-check.webm"],
    });
  });
});

describe("a missing source fails the build", () => {
  it("a screen without its manual block, not pending, stops the build with its route", () => {
    const sources = fixtureSources({ pending: [] });
    expect(() => buildManual(sources)).toThrow(ManualError);
    try {
      buildManual(sources);
    } catch (error) {
      expect((error as ManualError).code).toBe(MANUAL_CODE.incomplete);
      expect((error as ManualError).message).toContain("the screen /app/settings has no manual.ts beside its page");
    }
  });

  it("a text without one of the languages", () => {
    expect(problemsWith({ [CHECK]: checkBlock.replace(', fr: "Vérifier un document"', "") })).toEqual([
      `${path.join("app", "check", "manual.ts")}: title has no fr text`,
    ]);
  });

  it("a field of the schema nobody described, and a description of a field the schema dropped", () => {
    const block = checkBlock.replace("note: {", "comment: {");
    expect(problemsWith({ [CHECK]: block })).toEqual([
      expect.stringContaining("actions[0].fields.comment describes a field the input schema does not have"),
      expect.stringContaining("actions[0]: the field « note » has no text"),
    ]);
  });

  it("an action whose route handler moved, or does not export the method", () => {
    expect(problemsWith({ [CHECK]: checkBlock.replace("POST /api/documents", "POST /api/files") })).toEqual([
      expect.stringContaining("no route handler answers /api/files (route.ts missing or moved)"),
    ]);
    expect(problemsWith({ [CHECK]: checkBlock.replace("POST /api/documents", "PUT /api/documents") })).toEqual([
      expect.stringContaining("the route handler of /api/documents exports no PUT"),
    ]);
    expect(problemsWith({ [CHECK]: checkBlock.replace("POST /api/documents", "post documents") })).toEqual([
      expect.stringContaining('route must read "<METHOD> /<path>"'),
    ]);
  });

  it("an error code the catalogue has no words for, in one language", () => {
    const errors = {
      en: { FILE_TOO_LARGE: "Too large.", EXTRACTING: "Reading.", NOT_FOUND: "Not found." },
      fr: { NOT_FOUND: "Introuvable." },
    };
    expect(problemsWith({}, { errors })).toEqual([
      expect.stringContaining("error FILE_TOO_LARGE has no fr text in the error catalogue"),
      expect.stringContaining("error EXTRACTING has no fr text in the error catalogue"),
    ]);
    expect(problemsWith({}, { errors: undefined })[0]).toContain("no error catalogue was passed to the extractor");
  });

  it("a « how to » that does not follow its journey: an unknown journey, a step count that drifted", () => {
    expect(problemsWith({}, { journeys: [] })).toEqual([
      expect.stringContaining("no journey « start-a-check » in the product's journeys"),
    ]);
    const longer = [
      { id: "start-a-check", steps: ["sign in", "drop", "answer « Which document? »", "see the report"] },
    ];
    expect(problemsWith({}, { journeys: longer })).toEqual([
      expect.stringContaining("the journey « start-a-check » has 4 steps, the manual 3: describe each one"),
    ]);
  });

  it("a value the compiler cannot read without running the code is refused with its line", () => {
    const block = checkBlock.replace(
      'summary: { en: "Drop a document and Verikora reads it."',
      'summary: { en: "Drop a document".toUpperCase()',
    );
    expect(problemsWith({ [CHECK]: block })).toEqual([
      expect.stringMatching(/line 10: « "Drop a document".toUpperCase\(\) » cannot be read at build/),
    ]);
    expect(problemsWith({ [CHECK]: "export const other = 1;\n" })).toEqual([
      expect.stringContaining("exports no `manual`"),
    ]);
  });

  it("a template the compiler folds into one literal is read, as the type checker sees it", () => {
    const block = checkBlock.replace(
      'summary: { en: "Drop a document and Verikora reads it."',
      "summary: { en: `Drop it (${CODE.tooLarge} above 10 MB)`",
    );
    const manual = buildManual(fixtureSources({ program: fixtureProgram({ [CHECK]: block }) }));
    expect(manual.pages[0]?.summary.en).toBe("Drop it (FILE_TOO_LARGE above 10 MB)");
  });

  it("the pending list only goes down: a documented screen or a vanished one left in it fails", () => {
    expect(problemsWith({}, { pending: ["/app/settings", "/app/check", "/app/gone"] })).toEqual([
      expect.stringContaining("the screen /app/check is documented: remove it from pending"),
      "pending: /app/gone is not a screen any more: remove it",
    ]);
  });

  it("a manual block whose page was removed is stale", () => {
    const page = path.join(SCREENS, "app", "check", "page.tsx");
    expect(problemsWith({ [page]: null })).toEqual([
      `${path.join("app", "check", "manual.ts")}: a manual block beside no page`,
    ]);
  });
});
