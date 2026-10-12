// The `krizaka` ESLint plugin: one object carrying every rule, so that configs registering it compose (flat config
// refuses two different objects under the same plugin name).
import { noDirectTanstackImport, noFetchInClientEffect, noLocaleTernaryRule,noLocalTableOrForm } from "./rules.js";

/** @type {import("eslint").ESLint.Plugin} */
export const krizakaPlugin = {
  meta: { name: "@krizaka/config" },
  rules: {
    "no-locale-ternary": noLocaleTernaryRule,
    "no-fetch-in-client-effect": noFetchInClientEffect,
    "no-direct-tanstack-import": noDirectTanstackImport,
    "no-local-table-or-form": noLocalTableOrForm,
  },
};

export default krizakaPlugin;
