import { integer, type Registry } from "@krizaka/settings";

import type { ActionLimit } from "./port";

/** What a product declares for an action: the defaults the admin can then change. */
export interface ActionDefaults {
  perIp?: number;
  perSubject?: number;
  windowSeconds: number;
}

/** An action id that can sit in a settings key (`limits.signIn.perIp`): letters and digits, starting with a lower-case letter. */
const ACTION_ID = /^[a-z][A-Za-z0-9]{0,39}$/;

/**
 * The registry fragment of the limits: `limits.<action>.perIp`, `limits.<action>.perSubject` (when the action has one) and
 * `limits.<action>.windowSeconds`, each an integer with the product's default and bounds. Global scope. The admin changes a limit
 * without a redeploy; `limitsFromSettings` reads them back for the limiter.
 * @param actions the product's actions, by id (camelCase: `signIn`, `passwordForgot`), with their defaults
 * @throws RangeError for an action id that cannot be part of a settings key
 */
export function rateLimitSettings(actions: Readonly<Record<string, ActionDefaults>>): Registry {
  const fragment: Registry = {};
  for (const [action, defaults] of Object.entries(actions)) {
    if (!ACTION_ID.test(action))
      throw new RangeError(
        `rate-limit action « ${action} »: use letters and digits, starting with a lower-case letter (it is part of a settings key)`,
      );
    // @fixed: an admin may set 1 to a million hits and a window of a second to a day; the defaults are the product's
    if (defaults.perIp !== undefined)
      fragment[`limits.${action}.perIp`] = integer("limits", defaults.perIp, { min: 1, max: 1_000_000, unit: "hits" });
    if (defaults.perSubject !== undefined)
      fragment[`limits.${action}.perSubject`] = integer("limits", defaults.perSubject, {
        min: 1,
        max: 1_000_000,
        unit: "hits",
      });
    fragment[`limits.${action}.windowSeconds`] = integer("limits", defaults.windowSeconds, {
      min: 1,
      max: 86_400,
      unit: "seconds",
    });
  }
  return fragment;
}

/**
 * The limiter's `limits` function over the settings: it reads the keys of an action. `read` is the product's accessor
 * (`(key) => service.get(key, ctx)`); a key the action does not declare answers `undefined` and is left out.
 */
export function limitsFromSettings(
  read: (key: string) => number | undefined | Promise<number | undefined>,
): (action: string) => Promise<ActionLimit | undefined> {
  return async (action) => {
    const windowSeconds = await read(`limits.${action}.windowSeconds`);
    if (windowSeconds === undefined) return undefined;
    const perIp = await read(`limits.${action}.perIp`);
    const perSubject = await read(`limits.${action}.perSubject`);
    return {
      windowSeconds,
      ...(perIp === undefined ? {} : { perIp }),
      ...(perSubject === undefined ? {} : { perSubject }),
    };
  };
}
