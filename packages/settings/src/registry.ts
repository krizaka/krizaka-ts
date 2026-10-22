import { z } from "zod";

/**
 * A product's settings as a typed registry: its key, its type, its default and the scopes it can be overridden at. Settings are DATA in
 * the database, changed by an administrator without a redeploy; the registry is the one place that says what exists, so the admin
 * forms, the validation and the checks at the server boundary all read the same list.
 */
export const SCOPE = { global: "global", workspace: "workspace", user: "user" } as const;
export type Scope = (typeof SCOPE)[keyof typeof SCOPE];
/** The order a value is looked up in: the most specific wins (user, then workspace, then global). */
export const SCOPES_BY_SPECIFICITY = [SCOPE.user, SCOPE.workspace, SCOPE.global] as const;

export const KIND = { flag: "flag", integer: "integer", choice: "choice", bilingual: "bilingual", subset: "subset" } as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export interface Def<T = unknown> {
  /** The admin screen the setting belongs to (the product names its own groups). */
  group: string;
  kind: Kind;
  schema: z.ZodType<T>;
  default: T;
  scopes: readonly Scope[];
  /** For a number: its bounds and unit; for a choice or a subset: the values. */
  min?: number;
  max?: number;
  unit?: string;
  choices?: readonly string[];
}

export const ALL_SCOPES: readonly Scope[] = [SCOPE.global, SCOPE.workspace, SCOPE.user];
export const WORKSPACE_SCOPES: readonly Scope[] = [SCOPE.global, SCOPE.workspace];
export const GLOBAL_ONLY: readonly Scope[] = [SCOPE.global];

export const flag = (group: string, value: boolean, scopes: readonly Scope[] = GLOBAL_ONLY): Def<boolean> => ({ group, kind: KIND.flag, schema: z.boolean(), default: value, scopes });
export const integer = (group: string, value: number, bounds: { min: number; max: number; unit?: string }, scopes: readonly Scope[] = GLOBAL_ONLY): Def<number> => ({ group, kind: KIND.integer, schema: z.number().int().min(bounds.min).max(bounds.max), default: value, scopes, ...bounds });
export const choice = <const C extends readonly [string, ...string[]]>(group: string, choices: C, value: C[number], scopes: readonly Scope[] = GLOBAL_ONLY): Def<C[number]> => ({ group, kind: KIND.choice, schema: z.enum(choices), default: value, scopes, choices });
export const subset = <const C extends readonly [string, ...string[]]>(group: string, choices: C, value: C[number][], scopes: readonly Scope[] = GLOBAL_ONLY): Def<C[number][]> => ({ group, kind: KIND.subset, schema: z.array(z.enum(choices)).min(1), default: value, scopes, choices });
export const bilingual = (group: string, value: { fr: string; en: string }, scopes: readonly Scope[] = GLOBAL_ONLY): Def<{ fr: string; en: string }> => ({ group, kind: KIND.bilingual, schema: z.object({ fr: z.string().trim().min(1).max(500), en: z.string().trim().min(1).max(500) }), default: value, scopes });

/** A registry: keys to definitions (write it `as const satisfies Registry` to keep the keys and the value types). */
export type Registry = Record<string, Def<never> | Def<boolean> | Def<number> | Def<string> | Def<string[]> | Def<{ fr: string; en: string }>>;
export type KeyOf<R extends Registry> = keyof R & string;
export type ValueOf<R extends Registry, K extends KeyOf<R>> = z.infer<R[K]["schema"]>;

/** The tools over one registry: what is a key, its definition, the keys of a group. */
export function defineSettings<R extends Registry>(registry: R) {
  const keys = Object.keys(registry) as KeyOf<R>[];
  const defOf = (key: KeyOf<R>): Def => registry[key] as unknown as Def;
  return {
    registry,
    keys,
    isKey: (key: string): key is KeyOf<R> => Object.hasOwn(registry, key),
    defOf,
    keysOfGroup: (group: string): KeyOf<R>[] => keys.filter((k) => defOf(k).group === group),
  };
}
export type SettingsDefinition<R extends Registry> = ReturnType<typeof defineSettings<R>>;
