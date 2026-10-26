import { defineConfig } from "tsup";

/** ESM + types. */
export default defineConfig({ entry: { index: "src/index.ts" }, format: ["esm"], dts: true, sourcemap: true, clean: false, target: "es2022" });
