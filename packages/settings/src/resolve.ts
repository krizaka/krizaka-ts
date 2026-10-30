import { type Def, type Scope, SCOPES_BY_SPECIFICITY } from "./registry";

/** What each scope has set for one key (absent = not overridden there). */
export type Layers = Partial<Record<Scope, unknown>>;
export interface Resolved<T = unknown> {
  value: T;
  /** Where the value comes from: the scope that set it, or `default`. */
  source: Scope | "default";
}

/** The effective value: user, then workspace, then global, then the default. A scope the setting cannot be set at is never read. */
export function resolveValue(def: Def, layers: Layers, fallback?: unknown): Resolved {
  for (const scope of SCOPES_BY_SPECIFICITY) {
    if (def.scopes.includes(scope) && layers[scope] !== undefined) return { value: layers[scope], source: scope };
  }
  return { value: fallback !== undefined ? fallback : def.default, source: "default" };
}
