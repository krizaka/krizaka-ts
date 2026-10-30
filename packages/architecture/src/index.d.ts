export type C4LevelName = "context" | "containers" | "components";

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
export function buildC4(repoPath: string): C4;
export function toText(c4: C4): string;
