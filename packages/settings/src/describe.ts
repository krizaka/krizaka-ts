import type { KeyOf, Kind, Registry, Scope, SettingsDefinition } from "./registry";

/** A setting as an administration screen draws it: JSON-safe (no schema), so it can cross to the browser. */
export interface SettingDescription<K extends string = string> {
  key: K;
  group: string;
  kind: Kind;
  default: unknown;
  scopes: readonly Scope[];
  min?: number;
  max?: number;
  unit?: string;
  choices?: readonly string[];
}

export const describeSettings = <R extends Registry>(settings: SettingsDefinition<R>): SettingDescription<KeyOf<R>>[] =>
  settings.keys.map((key) => {
    const { group, kind, default: dflt, scopes, min, max, unit, choices } = settings.defOf(key);
    return { key, group, kind, default: dflt, scopes, min, max, unit, choices };
  });
