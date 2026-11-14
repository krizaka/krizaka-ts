export type C4LevelName = "context" | "containers" | "components";

export type Ecosystem = "npm" | "maven" | "cargo" | "python";
export type Language = "typescript" | "javascript" | "java" | "rust" | "python";

/** An org dependency of a unit: `@krizaka/*`, `com.krizaka*` (`groupId:artifactId`), a `krizaka-*` crate, a `krizaka*` Python package. */
export interface OrgDependency {
  ecosystem: Ecosystem;
  name: string;
  /** What the manifest says: a range, a version, `managed` (Maven, from a BOM), a git tag or rev. */
  range: string;
  /** The version that builds the unit: the lockfile's for npm, else the pin's plain version; null when neither says one. */
  have: string | null;
  from: "lockfile" | "range";
  /** A development (or test-scope) dependency. */
  dev: boolean;
  /** Maven: the dependency is the unit's parent POM. */
  parent?: boolean;
}

/** A unit of a repository: a package.json of the workspace, a module of the Maven reactor, a crate or a Python project. */
export interface Unit {
  /** Repo-relative directory, `.` for the root. */
  path: string;
  manifest: string;
  ecosystem: Ecosystem;
  language: Language;
  /** The package name (`groupId:artifactId` for Maven); null for a requirements.txt alone. */
  name: string | null;
  version: string | null;
  /** An org package others can depend on (not private, in the org's namespace). */
  published: boolean;
  /** Maven only. */
  packaging?: string;
  /** Maven only: the directories of its modules. */
  modules?: string[];
  dependsOn: OrgDependency[];
}

export interface C4Node {
  id: string;
  level: "system" | "container" | "component" | "external";
  kind: "system" | "app" | "library" | "module" | "component" | "external";
  name: string;
  description: string;
  technology?: string;
  /** Repo-relative files behind the node (capped at 200; `fileCount` is the true number). */
  files: string[];
  fileCount: number;
  /** A container's unit, when its manifest says one: */
  ecosystem?: Ecosystem;
  language?: Language;
  version?: string | null;
  published?: boolean;
  dependsOn?: OrgDependency[];
}

export interface C4Edge {
  from: string;
  to: string;
  /** `uses` (container depends on / imports another), `imports` (component to component), `reads` (env of an external service). */
  label: "uses" | "imports" | "reads";
  count: number;
  files: string[];
}

export interface C4Level {
  level: C4LevelName;
  nodes: C4Node[];
  edges: C4Edge[];
}

export interface C4 {
  schema: "krizaka.c4/1";
  repo: string;
  levels: Record<C4LevelName, C4Level>;
}

export const SCHEMA: "krizaka.c4/1";
/** The C4 view of a checkout on disk. */
export function buildC4(repoPath: string): C4;
/** The C4 view of a repository's files (`path -> text`, repo-relative): the same output as `buildC4` for the same files. */
export function buildC4FromFiles(files: Map<string, string>, options?: { name?: string }): C4;
export function toText(c4: C4): string;
/** Every unit of a repository's files, sorted by path then ecosystem. */
export function unitsOf(files: Map<string, string>): Unit[];
/** Is a package an org package, per ecosystem? */
export const isOrgPackage: Record<Ecosystem, (name: string) => boolean>;
/** "0.19.0" from "^0.19.0", "~0.19.0", ">=0.19.0" or "0.19.0"; null for `workspace:`, tags, git or complex ranges. */
export function baseVersion(range: string | null | undefined): string | null;
/** Does a directory match a workspace glob (`apps/*`, `packages/**`, `deploy/backup`)? */
export function globMatches(glob: string, dir: string): boolean;

export type Point = readonly [number, number];
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node of a laid-out view (pixels, rounded). `compound` nodes hold others (their `parent` points at them). */
export interface ArchNode extends Box {
  id: string;
  parent: string | null;
  kind: string;
  shape: string;
  title: string;
  technology: string | null;
  description: string | null;
  compound: boolean;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
  /** Bézier points, start to end (or target to source when `back`). */
  points: readonly Point[];
  labelBBox: Box | null;
  /** The step number of a dynamic view's edge, in the model's order; null in a static view. */
  step: number | null;
  /** Graphviz drew the edge against its rank: the points run from the target to the source. */
  back: boolean;
}

export interface ArchView {
  id: string;
  title: string;
  dynamic: boolean;
  bounds: Box;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export interface ModelFile {
  path: string;
  text: string;
}

export interface HashedFile {
  path: string;
  sha256: string;
}

export type ModelRule = "model" | "no-specification" | "home" | "views";

export interface ModelProblem {
  rule: ModelRule;
  path: string;
  line: number;
  message: string;
}

export interface LayoutOptions {
  /** The org's files the model is written against (specification, org elements). With a base, a model writes no specification. */
  base?: ModelFile[];
  /** The system a model may only extend: every element it adds must have an id inside it (`platform.tooling.x`). */
  system?: string;
  /** The view ids to return, in this order; each must exist. Default: every view LikeC4 does not add by itself (not the implicit `index`), the containers view for a C4. */
  views?: string[];
}

export interface Layout {
  schema: "krizaka.layout/1";
  tool: { name: "@krizaka/architecture"; likec4: string };
  /** The sha256 of every source file: the model's and the base's. */
  sources: { model: HashedFile[]; base: HashedFile[] };
  /** The check's verdict: `ok` (a refused model throws), the system it was checked against, the elements the model adds. */
  check: { status: "ok"; system: string | null; errors: []; elements: string[] };
  views: ArchView[];
}

export const LAYOUT_SCHEMA: "krizaka.layout/1";
export const RULES: Readonly<Record<"model" | "specification" | "home" | "views", ModelRule>>;

/** A model the check refuses. `rule` is the first rule that failed; `problems` lists every one. */
export class ArchitectureModelError extends Error {
  readonly rule: ModelRule;
  readonly problems: ModelProblem[];
  constructor(problems: ModelProblem[]);
}

/**
 * Check a LikeC4 model with the org's rules and lay its views out, at build time. Deterministic: the same sources give the
 * same layout. Takes a LikeC4 text, a list of files, or the C4 `buildC4` returns (its containers view, no hand-written model).
 * @throws {ArchitectureModelError}
 */
export function layoutViews(model: string | ModelFile[] | C4, options?: LayoutOptions): Promise<Layout>;
/** The LikeC4 files of a C4's containers level (a specification, the containers, their relations, a `containers` view). */
export function modelOfC4(c4: C4): ModelFile[];
