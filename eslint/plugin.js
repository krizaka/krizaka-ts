// The `krizaka` ESLint plugin: one object carrying every rule, so that configs registering it compose (flat config
// refuses two different objects under the same plugin name).
import { envName, noDirectTanstackImport, noFamilySwitcher, noFetchInClientEffect, noLightVariant, noLocaleTernaryRule, noLocalTableOrForm, noRawPalette } from "./rules.js";

/** @type {import("eslint").ESLint.Plugin} */
export const krizakaPlugin = {
  meta: { name: "@krizaka/config" },
  rules: {
    "no-locale-ternary": noLocaleTernaryRule,
    "no-fetch-in-client-effect": noFetchInClientEffect,
    "no-direct-tanstack-import": noDirectTanstackImport,
    "no-local-table-or-form": noLocalTableOrForm,
    "no-light-variant": noLightVariant,
    "no-raw-palette": noRawPalette,
    "env-name": envName,
    "no-family-switcher": noFamilySwitcher,
  },
};

export default krizakaPlugin;
