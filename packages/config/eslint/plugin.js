// The `krizaka` ESLint plugin: one object carrying every rule, so that configs registering it compose (flat config
// refuses two different objects under the same plugin name).
import { envName, noFamilySwitcher, noFetchInClientEffect, noLightVariant, noLocaleTernaryRule, noLocalTableOrForm, noRawPalette,routeStateSelection } from "./rules.js";

/** @type {import("eslint").ESLint.Plugin} */
export const krizakaPlugin = {
  meta: { name: "@krizaka/config" },
  rules: {
    "no-locale-ternary": noLocaleTernaryRule,
    "no-fetch-in-client-effect": noFetchInClientEffect,
    "no-local-table-or-form": noLocalTableOrForm,
    "no-light-variant": noLightVariant,
    "no-raw-palette": noRawPalette,
    "env-name": envName,
    "no-family-switcher": noFamilySwitcher,
    "route-state-selection": routeStateSelection,
  },
};

export default krizakaPlugin;
