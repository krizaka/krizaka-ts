import { type KeyOf, type Registry, SCOPE, type SettingsDefinition } from "./registry";
import { GLOBAL, type SettingsService } from "./service";

/**
 * A deployment that was configured by environment before settings existed keeps behaving the same: at server start, each legacy value
 * that differs from the registry's default is written ONCE as a global setting — and only when nobody has set it since. From then on
 * the administration owns it; the environment is never read again. `legacy` maps a setting key to its legacy value.
 */
export async function seedLegacySettings<R extends Registry>(
  settings: SettingsDefinition<R>,
  service: SettingsService<R>,
  legacy: Partial<Record<KeyOf<R>, unknown>>,
  now: Date,
): Promise<KeyOf<R>[]> {
  const seeded: KeyOf<R>[] = [];
  const existing = await service.overrides(GLOBAL);
  for (const key of Object.keys(legacy) as KeyOf<R>[]) {
    if (existing[key] !== undefined || legacy[key] === settings.defOf(key).default) continue;
    await service.set(
      { id: null, label: "server start (legacy environment)" },
      { scope: SCOPE.global, id: "" },
      key,
      legacy[key],
      now,
    );
    seeded.push(key);
  }
  return seeded;
}
