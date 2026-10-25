// The package lints itself with the configuration it publishes (relative: it cannot depend on its own published version).
import { krizakaBase } from "./eslint/index.js";

export default [
  ...krizakaBase,
  { name: "config/fixtures", ignores: ["test/fixtures/**"] },
  // dependency-cruiser requires CommonJS configs: these two files are `require`d by it and cannot be modules
  { name: "config/commonjs", files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];
