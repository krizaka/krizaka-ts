// The package lints itself with the configuration it publishes (relative: it cannot depend on its own published version).
import { krizakaBase } from "./eslint/index.js";

export default [...krizakaBase, { name: "config/fixtures", ignores: ["test/fixtures/**"] }];
