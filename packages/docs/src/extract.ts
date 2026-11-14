/**
 * The extractor of the user manual (krizaka-internal#3644): it reads the product's TypeScript program — never its source as text — and
 * builds one page per screen from the `manual.ts` beside the screen's page, checked against what the code holds today:
 *
 * - every screen under `screens` has its manual block, unless it is in `pending` (a list that only goes down);
 * - every action names a route handler that exists and exports its method;
 * - every input field of an action's schema is described, and every description names a field the schema still has;
 * - every error code and setting key is in the product's catalogue, in every language;
 * - every « how to » names a journey of the product, with as many steps as the journey proves.
 *
 * Any gap is a problem; `buildManual` throws them all at once, so the build fails and a stale page cannot be published.
 */
import path from "node:path";

import ts from "typescript";

import { evaluate, type Evaluated, type Literal, SchemaRef } from "./evaluate";
import {
  HTTP_METHODS,
  type HttpMethod,
  type Manual,
  type ManualActionPage,
  type ManualEntry,
  ManualError,
  type ManualField,
  type ManualHowToPage,
  type ManualPage,
  type ManualProblem,
  type Text,
} from "./manual";
import { HANDLER_FILE, MANUAL_FILE, routeOf, SCREEN_FILE } from "./routes";

/** A catalogue by language, then by key: the product's messages for its error codes (`{ en: { FILE_TOO_LARGE: "…" }, fr: … }`). */
export type Catalogue = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** An e2e journey as the product's manifest declares it, with the paths of its recordings when there are some. */
export interface JourneyFact {
  id: string;
  steps: readonly string[];
  media?: readonly string[];
}

export interface ManualSources {
  /** The product's program (`programOf("apps/web/tsconfig.json")`); its files must include the `manual.ts` blocks. */
  program: ts.Program;
  /** The app router's folder, where `api/…/route.ts` handlers live (absolute). */
  app: string;
  /** The folder whose pages are the screens of the manual (absolute), e.g. `app/[locale]/(app)`. */
  screens: string;
  /** The languages every text must have. */
  locales?: readonly string[];
  /** Screens not documented yet, by route. A documented or vanished screen left in it is a problem. */
  pending?: readonly string[];
  errors?: Catalogue;
  settings?: Catalogue;
  journeys?: readonly JourneyFact[];
}

const DEFAULT_LOCALES = ["en", "fr"] as const;
const DEFAULT_ORDER = 1000;

/** The program of a `tsconfig.json`, as the product's compiler sees it. */
export function programOf(tsconfig: string): ts.Program {
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile.bind(ts.sys));
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfig));
  return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
}

const isRecord = (v: Literal | undefined): v is { readonly [key: string]: Literal } =>
  typeof v === "object" && !Array.isArray(v) && !(v instanceof SchemaRef);

/** The files of the program that belong to the product, by folder. */
function productFiles(program: ts.Program): ts.SourceFile[] {
  return program.getSourceFiles().filter((f) => !f.isDeclarationFile && !f.fileName.includes("/node_modules/"));
}

const inside = (file: string, folder: string) => !path.relative(folder, file).startsWith("..");

/** The route handlers of the app, by address, with the methods each exports. */
function handlers(files: ts.SourceFile[], app: string, checker: ts.TypeChecker): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of files) {
    if (!HANDLER_FILE.test(path.basename(file.fileName))) continue;
    const route = routeOf(file.fileName, app);
    const module = checker.getSymbolAtLocation(file);
    if (route === null || !module) continue;
    out.set(route, new Set(checker.getExportsOfModule(module).map((s) => s.name)));
  }
  return out;
}

/** The expression a module exports as `manual`. */
function manualExpression(file: ts.SourceFile, checker: ts.TypeChecker): ts.Expression | undefined {
  const module = checker.getSymbolAtLocation(file);
  const symbol = module && checker.getExportsOfModule(module).find((s) => s.name === "manual");
  const declaration = symbol?.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
}

/** The fields a user sends through a Standard Schema (zod, valibot…): its input type's properties. Null when it is not one. */
function inputFields(ref: SchemaRef, checker: ts.TypeChecker): Omit<ManualField, "text">[] | null {
  const at = ref.node;
  const member = (type: ts.Type | undefined, name: string) => {
    const symbol = type?.getProperty(name);
    return symbol ? checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(symbol, at)) : undefined;
  };
  const input = member(member(member(checker.getTypeAtLocation(at), "~standard"), "types"), "input");
  if (!input) return null;
  return checker.getPropertiesOfType(input).map((field) => {
    const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(field, at));
    const parts = type.isUnion() ? type.types : [type];
    const closed = parts.every((t) => t.isStringLiteral());
    return {
      name: field.name,
      required: (field.flags & ts.SymbolFlags.Optional) === 0,
      choices: closed ? parts.map((t) => (t as ts.StringLiteralType).value) : [],
    };
  });
}

/** Reads one manual block into a page, writing every gap it meets into `problems`. */
class BlockReader {
  constructor(
    private readonly file: string,
    private readonly sources: ManualSources & { locales: readonly string[] },
    private readonly routes: Map<string, Set<string>>,
    private readonly checker: ts.TypeChecker,
    private readonly problems: ManualProblem[],
  ) {}

  private fail(message: string): void {
    this.problems.push({ file: this.file, message });
  }

  text(value: Literal | undefined, where: string): Text | null {
    if (!isRecord(value)) {
      const shape = this.sources.locales.map((l) => l + ': "…"').join(", ");
      this.fail(`${where} has no text: write it as { ${shape} }`);
      return null;
    }
    const missing = this.sources.locales.filter((l) => {
      const v = value[l];
      return typeof v !== "string" || v.trim() === "";
    });
    if (missing.length > 0) {
      this.fail(`${where} has no ${missing.join(", ")} text`);
      return null;
    }
    return Object.fromEntries(this.sources.locales.map((l) => [l, value[l]])) as unknown as Text;
  }

  private list(value: Literal | undefined, where: string): readonly Literal[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value as readonly Literal[];
    this.fail(`${where} is not a list`);
    return [];
  }

  entries(value: Literal | undefined, catalogue: Catalogue | undefined, kind: string, where: string): ManualEntry[] {
    const out: ManualEntry[] = [];
    for (const key of this.list(value, where)) {
      if (typeof key !== "string") {
        this.fail(`${where} holds a ${kind} that is not a key`);
        continue;
      }
      if (!catalogue) {
        this.fail(`${where} names ${kind} ${key}, but no ${kind} catalogue was passed to the extractor`);
        continue;
      }
      const missing = this.sources.locales.filter((l) => {
        const v = catalogue[l]?.[key];
        return typeof v !== "string" || v.trim() === "";
      });
      if (missing.length > 0) {
        this.fail(`${where}: ${kind} ${key} has no ${missing.join(", ")} text in the ${kind} catalogue`);
        continue;
      }
      out.push({ key, text: Object.fromEntries(this.sources.locales.map((l) => [l, catalogue[l]?.[key]])) as Text });
    }
    return out;
  }

  /** The fields the action's schema declares, or those described when it has none; null when its schema cannot be read. */
  private declaredFields(
    schema: Literal | undefined,
    texts: { readonly [key: string]: Literal },
    where: string,
  ): Omit<ManualField, "text">[] | null {
    if (schema === undefined) return Object.keys(texts).map((name) => ({ name, required: true, choices: [] }));
    const read = schema instanceof SchemaRef ? inputFields(schema, this.checker) : null;
    if (read === null) {
      this.fail(`${where}.input is not a schema the extractor can read (a Standard Schema: zod, valibot…)`);
      return null;
    }
    const names = new Set(read.map((f) => f.name));
    for (const name of Object.keys(texts).filter((n) => !names.has(n)))
      this.fail(`${where}.fields.${name} describes a field the input schema does not have`);
    return read;
  }

  private fields(action: { readonly [key: string]: Literal }, where: string): ManualField[] {
    const described = action.fields;
    if (described !== undefined && !isRecord(described)) {
      this.fail(`${where}.fields is not an object`);
      return [];
    }
    const texts = described ?? {};
    const out: ManualField[] = [];
    for (const field of this.declaredFields(action.input, texts, where) ?? []) {
      const text = this.text(texts[field.name], `${where}: the field « ${field.name} »`);
      if (text) out.push({ ...field, text });
    }
    return out;
  }

  private action(value: Literal, where: string): ManualActionPage | null {
    if (!isRecord(value)) {
      this.fail(`${where} is not an object`);
      return null;
    }
    const route = typeof value.route === "string" ? value.route.split(" ") : [];
    const [method, address] = route;
    if (route.length !== 2 || !method || !address || !(HTTP_METHODS as readonly string[]).includes(method)) {
      this.fail(`${where}.route must read "<METHOD> /<path>", e.g. "POST /api/documents"`);
      return null;
    }
    const exported = this.routes.get(address);
    if (!exported) this.fail(`${where}: no route handler answers ${address} (route.ts missing or moved)`);
    else if (!exported.has(method)) this.fail(`${where}: the route handler of ${address} exports no ${method}`);
    const title = this.text(value.title, `${where}.title`);
    const does = this.text(value.does, `${where}.does`);
    const fields = this.fields(value, where);
    const errors = this.entries(value.errors, this.sources.errors, "error", `${where}.errors`);
    if (!title || !does || !exported?.has(method)) return null;
    return { method: method as HttpMethod, path: address, title, does, fields, errors };
  }

  actions(value: Literal | undefined): ManualActionPage[] {
    return this.list(value, "actions").flatMap((a, i) => this.action(a, `actions[${i}]`) ?? []);
  }

  private oneHowTo(value: Literal, where: string): ManualHowToPage | null {
    if (!isRecord(value) || typeof value.journey !== "string") {
      this.fail(`${where} names no journey`);
      return null;
    }
    const journey = this.sources.journeys?.find((j) => j.id === value.journey);
    if (!journey) {
      this.fail(`${where}: no journey « ${value.journey} » in the product's journeys`);
      return null;
    }
    const title = this.text(value.title, `${where}.title`);
    const written = this.list(value.steps, `${where}.steps`);
    if (written.length !== journey.steps.length)
      this.fail(
        `${where}: the journey « ${journey.id} » has ${journey.steps.length} steps, the manual ${written.length}: describe each one`,
      );
    const steps = written.map((s, i) => this.text(s, `${where}.steps[${i}]`));
    if (!title || written.length !== journey.steps.length || steps.some((s) => s === null)) return null;
    return { journey: journey.id, title, steps: steps as Text[], media: journey.media ?? [] };
  }

  howTo(value: Literal | undefined): ManualHowToPage[] {
    return this.list(value, "howTo").flatMap((h, i) => this.oneHowTo(h, `howTo[${i}]`) ?? []);
  }
}

function pageOf(
  route: string,
  file: ts.SourceFile,
  sources: ManualSources & { locales: readonly string[] },
  routes: Map<string, Set<string>>,
  checker: ts.TypeChecker,
  problems: ManualProblem[],
): ManualPage | null {
  const source = path.relative(sources.screens, file.fileName);
  const expression = manualExpression(file, checker);
  if (!expression) {
    problems.push({ file: source, message: "exports no `manual` (export const manual = screen({ … }))" });
    return null;
  }
  const read: Evaluated = evaluate(expression, checker);
  if (!read.ok) {
    problems.push({
      file: source,
      message: `line ${read.line}: « ${read.text} » cannot be read at build: write a literal`,
    });
    return null;
  }
  if (!isRecord(read.value)) {
    problems.push({ file: source, message: "`manual` is not an object" });
    return null;
  }
  const block = read.value;
  const reader = new BlockReader(source, sources, routes, checker, problems);
  const before = problems.length;
  const title = reader.text(block.title, "title");
  const summary = reader.text(block.summary, "summary");
  const page = {
    route,
    source,
    order: typeof block.order === "number" ? block.order : DEFAULT_ORDER,
    actions: reader.actions(block.actions),
    settings: reader.entries(block.settings, sources.settings, "setting", "settings"),
    errors: reader.entries(block.errors, sources.errors, "error", "errors"),
    howTo: reader.howTo(block.howTo),
  };
  return title && summary && problems.length === before ? { ...page, title, summary } : null;
}

/** The screens' pages and the manual blocks under the screens' folder, by folder. */
function screenFiles(files: ts.SourceFile[], screens: string) {
  const pages = new Map<string, string>();
  const blocks = new Map<string, ts.SourceFile>();
  for (const file of files.filter((f) => inside(f.fileName, screens))) {
    const name = path.basename(file.fileName);
    if (SCREEN_FILE.test(name)) pages.set(path.dirname(file.fileName), file.fileName);
    if (name === MANUAL_FILE) blocks.set(path.dirname(file.fileName), file);
  }
  return { pages, blocks };
}

/** What `pending` must not hold, and the blocks whose page is gone: the lists that only go down. */
function staleProblems(
  pages: Map<string, string>,
  blocks: Map<string, ts.SourceFile>,
  pending: Set<string>,
  screens: string,
): ManualProblem[] {
  const routes = new Set([...pages.values()].map((page) => routeOf(page, screens) ?? "/"));
  const orphans = [...blocks].filter(([folder]) => !pages.has(folder));
  return [
    ...orphans.map(([, block]) => ({
      file: path.relative(screens, block.fileName),
      message: "a manual block beside no page",
    })),
    ...[...pending]
      .filter((route) => !routes.has(route))
      .map((route) => ({ file: "pending", message: `${route} is not a screen any more: remove it` })),
  ];
}

/** The manual and every gap found on the way; `buildManual` is the build's entry point. */
export function readManual(input: ManualSources): { manual: Manual; problems: ManualProblem[] } {
  const sources = { ...input, locales: input.locales ?? DEFAULT_LOCALES };
  const checker = sources.program.getTypeChecker();
  const files = productFiles(sources.program);
  const routes = handlers(files, sources.app, checker);
  const { pages: screenPages, blocks } = screenFiles(files, sources.screens);
  const pending = new Set(sources.pending ?? []);
  const problems: ManualProblem[] = [];
  const pages: ManualPage[] = [];
  for (const [folder, page] of screenPages) {
    const route = routeOf(page, sources.screens) ?? "/";
    const block = blocks.get(folder);
    const file = path.relative(sources.screens, page);
    if (block && pending.has(route))
      problems.push({ file, message: `the screen ${route} is documented: remove it from pending` });
    if (!block && !pending.has(route))
      problems.push({
        file,
        message: `the screen ${route} has no ${MANUAL_FILE} beside its page: write its manual block (or list the route in pending)`,
      });
    const built = block && pageOf(route, block, sources, routes, checker, problems);
    if (built) pages.push(built);
  }
  problems.push(...staleProblems(screenPages, blocks, pending, sources.screens));
  pages.sort((a, b) => a.order - b.order || a.route.localeCompare(b.route));
  return { manual: { pages, pending: [...pending].sort((a, b) => a.localeCompare(b)) }, problems };
}

/**
 * The manual, or a `ManualError` listing every gap: the product's build step calls it, so a screen without its text, a route that
 * moved, a field nobody described or an error code without words stops the build.
 * @throws ManualError `MANUAL_INCOMPLETE`
 */
export function buildManual(sources: ManualSources): Manual {
  const { manual, problems } = readManual(sources);
  if (problems.length > 0) throw new ManualError(problems);
  return manual;
}

export { MANUAL_CODE, ManualError, type ManualProblem } from "./manual";
