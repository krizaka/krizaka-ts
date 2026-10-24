// The two UI rules as named plugin rules, for the adoption: `krizaka/no-light-variant` (no `light:` — tokens do the
// theming) and `krizaka/no-raw-palette` (no `bg-zinc-900`, `text-violet-400`… — a role). Warnings: krizaka-ratchet counts
// the same patterns (`light`, `palette`), so a product adopts them now and brings each count to 0 by the end of its
// adoption. `krizakaUi()` stays the strict (error) set, on `no-restricted-syntax`.
import { krizakaPlugin } from "./plugin.js";

/** The rule names, as configured. */
export const UI_WARNING_RULES = Object.freeze(["krizaka/no-light-variant", "krizaka/no-raw-palette"]);

/**
 * Flat config: the two named UI rules on a product's components.
 * @param {{ allow?: string[], files?: string[], ignores?: string[], severity?: "warn" | "error" }} [options]
 *   `allow`: palette families tolerated for documented, isolated cases.
 * @returns {import("eslint").Linter.Config[]}
 */
export function krizakaUiWarnings({ allow = [], files = ["**/*.{jsx,tsx}"], ignores = [], severity = "warn" } = {}) {
  return [
    {
      name: "krizaka/ui-warnings",
      files,
      ...(ignores.length > 0 ? { ignores } : {}),
      plugins: { krizaka: krizakaPlugin },
      rules: { "krizaka/no-light-variant": severity, "krizaka/no-raw-palette": [severity, { allow }] },
    },
  ];
}

export default krizakaUiWarnings;
