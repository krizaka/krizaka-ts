import { defineConfig } from "tsup";

/** ESM + types: the library and its test helpers (`@krizaka/db/testing`). */
export default defineConfig({ entry: { index: "src/index.ts", testing: "src/testing.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022" });
