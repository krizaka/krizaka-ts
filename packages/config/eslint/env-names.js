// Environment variables are named by bounded context (krizaka/.github#46): `<CONTEXT>_<THING>`, never after a product
// (the repository's own, from its package.json, or one a config names) nor a vendor (BUNNY_…, MAILGUN_…) — a vendor is a value (MEDIA_STORAGE_PROVIDER=bunny). The rule
// `krizaka/env-name` reads `process.env.X`, `process.env["X"]` and `import.meta.env.X`; krizakaBase turns it on.

import { krizakaPlugin } from "./plugin.js";

export { krizakaPlugin } from "./plugin.js";
export { ENV_PLATFORM_NAMES, ENV_PRODUCT_PREFIXES, ENV_VENDOR_PREFIXES, envNamePrefixProblem, ownProductPrefix } from "./rules.js";

/**
 * Flat config: `krizaka/env-name` on the given files.
 * @param {{ files?: string[], products?: string[], vendors?: string[], allow?: string[] }} [options]
 *   `products`, `vendors`: extra refused prefixes; `allow`: extra names a platform sets.
 * @returns {import("eslint").Linter.Config[]}
 */
export function envNames({ files = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], products = [], vendors = [], allow = [] } = {}) {
  return [
    {
      name: "krizaka/env-name",
      files,
      plugins: { krizaka: krizakaPlugin },
      rules: { "krizaka/env-name": ["error", { products, vendors, allow }] },
    },
  ];
}

export default envNames;
