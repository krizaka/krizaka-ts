import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { ManualSources } from "../src/extract";

export const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "app");
export const SCREENS = path.join(FIXTURE, "app", "[locale]", "(app)");
export const CHECK = path.join(SCREENS, "app", "check", "manual.ts");

/**
 * The fixture's program, with some files replaced (a string) or removed (null) in memory, so each test changes one thing and the
 * fixture on disk stays the complete app.
 */
export function fixtureProgram(changes: Record<string, string | null> = {}): ts.Program {
  const read = ts.readConfigFile(path.join(FIXTURE, "tsconfig.json"), ts.sys.readFile.bind(ts.sys));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, FIXTURE);
  const host = ts.createCompilerHost(parsed.options);
  const changed = new Map(Object.entries(changes).map(([f, c]) => [path.resolve(FIXTURE, f), c]));
  const { fileExists, readFile } = host;
  host.fileExists = (f) => (changed.has(f) ? changed.get(f) !== null : fileExists.call(host, f));
  host.readFile = (f) => (changed.has(f) ? (changed.get(f) ?? undefined) : readFile.call(host, f));
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (f, language, ...rest) => {
    const content = changed.get(f);
    return typeof content === "string"
      ? ts.createSourceFile(f, content, language, true)
      : original(f, language, ...rest);
  };
  const roots = new Set(parsed.fileNames.map((f) => path.resolve(f)));
  for (const [f, c] of changed) {
    if (c === null) roots.delete(f);
    else roots.add(f);
  }
  return ts.createProgram({ rootNames: [...roots], options: parsed.options, host });
}

export const CATALOGUES = {
  errors: {
    en: { FILE_TOO_LARGE: "The file is larger than 10 MB.", NOT_FOUND: "Not found.", EXTRACTING: "Still reading." },
    fr: { FILE_TOO_LARGE: "Le fichier dépasse 10 Mo.", NOT_FOUND: "Introuvable.", EXTRACTING: "Lecture en cours." },
  },
  settings: {
    en: { "storage.maxMegabytes": "The largest file a person may upload." },
    fr: { "storage.maxMegabytes": "Le plus gros fichier qu’une personne peut envoyer." },
  },
};

export const JOURNEYS = [
  {
    id: "start-a-check",
    steps: ["sign in", "drop a lease", "see the report"],
    media: ["/journeys/start-a-check.webm"],
  },
];

/** The sources of the complete fixture app; a test overrides what it changes. */
export function fixtureSources(overrides: Partial<ManualSources> = {}): ManualSources {
  return {
    program: fixtureProgram(),
    app: path.join(FIXTURE, "app"),
    screens: SCREENS,
    pending: ["/app/settings"],
    journeys: JOURNEYS,
    ...CATALOGUES,
    ...overrides,
  };
}
